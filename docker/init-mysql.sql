CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    role VARCHAR(50) DEFAULT 'member',
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO users (name, email, role, bio) VALUES
('Alice Developer', 'alice@example.com', 'admin', 'Lead backend architect'),
('Bob Designer', 'bob@example.com', 'member', 'UI/UX specialist'),
('Charlie Tester', 'charlie@example.com', 'tester', 'QA champion');

INSERT INTO orders (user_id, total_amount, status) VALUES
(1, 199.50, 'completed'),
(1, 49.99, 'shipped'),
(2, 850.00, 'processing');
