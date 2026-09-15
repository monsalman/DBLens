CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'member',
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (name, email, role, bio) VALUES
('Alice Developer', 'alice@example.com', 'admin', 'Lead backend architect'),
('Bob Designer', 'bob@example.com', 'member', 'UI/UX specialist'),
('Charlie Tester', 'charlie@example.com', 'tester', 'QA champion');

INSERT INTO orders (user_id, total_amount, status) VALUES
(1, 199.50, 'completed'),
(1, 49.99, 'shipped'),
(2, 850.00, 'processing');
