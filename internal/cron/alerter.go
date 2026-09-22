package cron

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/dblens/dblens/internal/webhook"
)

// alertHTTPClient is the webhook dispatch client: the transport validates every
// resolved IP at dial time (blocking cloud metadata, link-local and loopback
// targets) and redirects are never followed, so a responding endpoint cannot
// bounce the request to an internal address.
var alertHTTPClient = &http.Client{
	Timeout:   15 * time.Second,
	Transport: webhook.NewSafeHTTPTransport(),
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// dispatch sends an HTTP POST alert to the configured webhook URL.
func dispatch(ctx context.Context, job CronJob, output string) error {
	url := job.AlertRule.WebhookURL
	if url == "" {
		return nil
	}

	// Defense in depth: never dispatch to a target that fails SSRF validation,
	// even if a job predating the create-time check is still in memory.
	if err := webhook.ValidateWebhookURL(url); err != nil {
		return err
	}

	msg := job.AlertRule.Message
	if msg == "" {
		msg = fmt.Sprintf("[DBLens Cron Alert] Job %q triggered: value=%s condition=%s threshold=%v",
			job.Name, output, job.AlertRule.Condition, job.AlertRule.Threshold)
	}

	payload := map[string]interface{}{
		"job_id":    job.ID,
		"job_name":  job.Name,
		"conn_id":   job.ConnID,
		"condition": job.AlertRule.Condition,
		"threshold": job.AlertRule.Threshold,
		"output":    output,
		"message":   msg,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	// Slack/Discord compatible: wrap in "text" field too
	slackPayload := map[string]interface{}{
		"text": msg,
		"attachments": []map[string]interface{}{{
			"color":  "danger",
			"fields": []map[string]string{{"title": "Job", "value": job.Name, "short": "true"}, {"title": "Output", "value": output, "short": "true"}},
		}},
		"data": payload,
	}

	body, err := json.Marshal(slackPayload)
	if err != nil {
		return err
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "DBLens-Cron/1.0")

	resp, err := alertHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook target returned HTTP %d", resp.StatusCode)
	}
	return nil
}
