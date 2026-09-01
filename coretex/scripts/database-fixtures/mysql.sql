CREATE TABLE samples (
    id integer PRIMARY KEY,
    label varchar(64) NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO samples (id, label) VALUES
    (1, 'alpha'),
    (2, 'beta'),
    (3, 'gamma');

CREATE VIEW sample_labels AS SELECT id, label FROM samples;
