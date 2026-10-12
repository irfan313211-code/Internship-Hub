const express = require("express");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));

const fields = [
  "title",
  "company",
  "location",
  "description",
  "internship_type",
  "stipend",
  "is_remote",
  "apply_url",
  "deadline",
];

const selectAll = db.prepare(
  "SELECT * FROM internships WHERE id = ?"
);

function toJSON(row) {
  if (!row) return row;
  return {
    ...row,
    is_remote: Boolean(row.is_remote),
  };
}

function validDate(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validate(body, partial = false) {
  const errors = [];
  const data = {};

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return { errors: ["Request body must be a JSON object."] };
  }

  const unknown = Object.keys(body).filter(
    (key) => !fields.includes(key)
  );

  if (unknown.length) {
    errors.push(`Unknown fields: ${unknown.join(", ")}`);
  }

  const required = [
    "title",
    "company",
    "location",
    "description",
    "internship_type",
    "stipend",
    "is_remote",
    "apply_url",
  ];

  for (const key of required) {
    if (!partial && body[key] === undefined) {
      errors.push(`${key} is required.`);
    }
  }

  const textFields = [
    "title", "company", "location", "description",
  ];

  for (const key of textFields) {
    if (body[key] === undefined) continue;

    if (typeof body[key] !== "string" ||
        !body[key].trim()) {
      errors.push(`${key} must be a non-empty string.`);
    } else if (body[key].trim().length > 5000) {
      errors.push(`${key} is too long.`);
    } else {
      data[key] = body[key].trim();
    }
  }

  if (body.internship_type !== undefined) {
    if (!["paid", "unpaid"].includes(body.internship_type)) {
      errors.push("internship_type must be paid or unpaid.");
    } else {
      data.internship_type = body.internship_type;
    }
  }

  if (body.stipend !== undefined) {
    if (!Number.isSafeInteger(body.stipend) ||
        body.stipend < 0) {
      errors.push("stipend must be a non-negative integer.");
    } else {
      data.stipend = body.stipend;
    }
  }

  if (body.is_remote !== undefined) {
    if (typeof body.is_remote !== "boolean") {
      errors.push("is_remote must be true or false.");
    } else {
      data.is_remote = Number(body.is_remote);
    }
  }

  if (body.apply_url !== undefined) {
    try {
      const url = new URL(body.apply_url);

      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname.includes(".")
      ) {
        throw new Error("Invalid URL");
      }

      data.apply_url = url.href;
    } catch {
      errors.push("apply_url must be a valid HTTP or HTTPS URL.");
    }
  }

  if (body.deadline !== undefined) {
    if (body.deadline === null || body.deadline === "") {
      data.deadline = null;
    } else if (!validDate(body.deadline)) {
      errors.push("deadline must be a valid YYYY-MM-DD date.");
    } else {
      data.deadline = body.deadline;
    }
  }

  if (
    data.internship_type === "unpaid" &&
    data.stipend > 0
  ) {
    errors.push("An unpaid internship cannot have a positive stipend.");
  }

  return { data, errors };
}

function sendValidation(res, result) {
  return res.status(400).json({
    error: "Validation failed",
    details: result.errors,
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// List internships: pagination, search and filters
app.get("/api/internships", (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);

    if (
      !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    ) {
      return res.status(400).json({
        error: "page must be >= 1; limit must be between 1 and 100.",
      });
    }

    const conditions = [];
    const params = {};

    if (req.query.search !== undefined) {
      const search = String(req.query.search).trim();

      if (search.length > 100) {
        return res.status(400).json({
          error: "search must be at most 100 characters.",
        });
      }

      conditions.push(
        "(title LIKE @search OR company LIKE @search OR location LIKE @search)"
      );
      params.search = `%${search}%`;
    }

    if (req.query.internship_type !== undefined) {
      if (!["paid", "unpaid"].includes(req.query.internship_type)) {
        return res.status(400).json({
          error: "internship_type must be paid or unpaid.",
        });
      }

      conditions.push("internship_type = @type");
      params.type = req.query.internship_type;
    }

    if (req.query.is_remote !== undefined) {
      if (!["true", "false"].includes(req.query.is_remote)) {
        return res.status(400).json({
          error: "is_remote must be true or false.",
        });
      }

      conditions.push("is_remote = @remote");
      params.remote = req.query.is_remote === "true" ? 1 : 0;
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const total = db.prepare(
      `SELECT COUNT(*) AS count FROM internships ${where}`
    ).get(params).count;

    const items = db.prepare(`
      SELECT * FROM internships
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      limit,
      offset: (page - 1) * limit,
    });

    res.json({
      data: items.map(toJSON),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get one internship
app.get("/api/internships/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid ID." });
    }

    const item = toJSON(selectAll.get(id));

    if (!item) {
      return res.status(404).json({ error: "Internship not found." });
    }

    res.json({ data: item });
  } catch (err) {
    next(err);
  }
});

// Create internship
app.post("/api/internships", (req, res, next) => {
  try {
    const result = validate(req.body);

    if (result.errors.length) {
      return sendValidation(res, result);
    }

    const d = result.data;

    const insert = db.prepare(`
      INSERT INTO internships (
        title, company, location, description,
        internship_type, stipend, is_remote,
        apply_url, deadline
      ) VALUES (
        @title, @company, @location, @description,
        @internship_type, @stipend, @is_remote,
        @apply_url, @deadline
      )
    `);

    const created = db.transaction(() => {
      const info = insert.run({
        ...d,
        deadline: d.deadline ?? null,
      });
      return toJSON(selectAll.get(Number(info.lastInsertRowid)));
    })();

    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// Update internship (PATCH = update supplied fields)
app.patch("/api/internships/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid ID." });
    }

    if (!selectAll.get(id)) {
      return res.status(404).json({ error: "Internship not found." });
    }

    const result = validate(req.body, true);

    if (result.errors.length) {
      return sendValidation(res, result);
    }

    const entries = Object.entries(result.data);

    if (!entries.length) {
      return res.status(400).json({
        error: "Provide at least one field to update.",
      });
    }

    const updates = Object.fromEntries(entries);
    const setClause = entries
      .map(([key]) => `${key} = @${key}`)
      .concat("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .join(", ");

    db.prepare(`
      UPDATE internships SET ${setClause} WHERE id = @id
    `).run({ ...updates, id });

    res.json({ data: toJSON(selectAll.get(id)) });
  } catch (err) {
    next(err);
  }
});

// Delete internship
app.delete("/api/internships/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid ID." });
    }

    const result = db.prepare(
      "DELETE FROM internships WHERE id = ?"
    ).run(id);

    if (!result.changes) {
      return res.status(404).json({ error: "Internship not found." });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Handle malformed JSON and unexpected errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON body." });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Internship API running at http://localhost:${PORT}`);
});