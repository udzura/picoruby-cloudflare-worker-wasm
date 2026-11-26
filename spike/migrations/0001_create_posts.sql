CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  title_length INTEGER GENERATED ALWAYS AS (length(title)) STORED
);
