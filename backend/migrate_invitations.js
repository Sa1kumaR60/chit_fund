const db = require('./db');

const query = `
CREATE TABLE IF NOT EXISTS chit_invitations (
  invitation_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  user_id INT NOT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chit_invitation (chit_id, user_id),
  CONSTRAINT fk_chit_invitations_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id),
  CONSTRAINT fk_chit_invitations_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);
`;

db.query(query, (err, results) => {
  if (err) {
    console.error("Error creating table:", err);
  } else {
    console.log("Table chit_invitations created successfully.");
  }
  process.exit();
});
