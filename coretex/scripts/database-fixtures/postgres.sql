CREATE TABLE samples (
    id integer PRIMARY KEY,
    label text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO samples (id, label) VALUES
    (1, 'alpha'),
    (2, 'beta'),
    (3, 'gamma');

CREATE VIEW sample_labels AS SELECT id, label FROM samples;
