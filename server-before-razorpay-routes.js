require("dotenv").config();
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const app = express();
const PORT = process.env.PORT || 3000;

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// =====================================================
// DATABASE
// =====================================================

const db = new Database(
    path.join(__dirname, "fixbyte.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// =====================================================
// DATABASE TABLES
// =====================================================

db.exec(`

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'Not Started',
    progress INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    due_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    project_id INTEGER,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    reference TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE,
    FOREIGN KEY(project_id)
        REFERENCES projects(id)
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS razorpay_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    razorpay_order_id TEXT NOT NULL UNIQUE,
    amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    razorpay_payment_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'Open',
    reply TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE
);

`);

// =====================================================
// ADD MISSING COLUMNS TO OLD DATABASE
// =====================================================

function ensureColumn(table, column, definition) {

    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();

    if (!columns.some(col => col.name === column)) {

        db.exec(`
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        `);

    }
}

ensureColumn(
    "projects",
    "description",
    "TEXT DEFAULT ''"
);

ensureColumn(
    "projects",
    "status",
    "TEXT DEFAULT 'Not Started'"
);

ensureColumn(
    "projects",
    "progress",
    "INTEGER DEFAULT 0"
);

ensureColumn(
    "projects",
    "total_amount",
    "REAL DEFAULT 0"
);

ensureColumn(
    "projects",
    "paid_amount",
    "REAL DEFAULT 0"
);

ensureColumn(
    "projects",
    "due_date",
    "TEXT"
);

ensureColumn(
    "projects",
    "updated_at",
    "DATETIME DEFAULT CURRENT_TIMESTAMP"
);

console.log("Database connected successfully.");

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "FIXBYTE_SECRET_2026",

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax",
            maxAge:
                1000 *
                60 *
                60 *
                24 *
                7,

            secure:
                process.env.NODE_ENV ===
                "production"
        }
    })
);

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// =====================================================
// HELPERS
// =====================================================

function clean(value) {

    return String(
        value ?? ""
    ).trim();

}

function requireCustomer(
    req,
    res,
    next
) {

    if (
        !req.session ||
        !req.session.customerId
    ) {

        return res.status(401).json({
            success: false,
            message: "Please login first."
        });

    }

    next();

}

function requireAdmin(
    req,
    res,
    next
) {

    if (
        req.session &&
        req.session.isAdmin === true
    ) {

        return next();

    }

    return res.status(401).json({
        success: false,
        message: "Admin login required."
    });

}

function money(value) {

    return Number(
        value || 0
    ).toLocaleString(
        "en-IN",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    );

}

// =====================================================
// HOME
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);

// =====================================================
// CUSTOMER SIGNUP
// =====================================================

app.post(
    "/api/signup",
    async (req, res) => {

        try {

            const name =
                clean(req.body.name);

            const mobile =
                clean(req.body.mobile);

            const email =
                clean(req.body.email)
                    .toLowerCase();

            const password =
                String(
                    req.body.password || ""
                );

            if (
                !name ||
                !mobile ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "All fields are required."
                });

            }

            if (
                password.length < 6
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 6 characters."
                });

            }

            const existing =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE email = ?
                    OR mobile = ?
                `).get(
                    email,
                    mobile
                );

            if (existing) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Email or mobile number is already registered."
                });

            }

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );

            const result =
                db.prepare(`
                    INSERT INTO customers
                    (
                        name,
                        mobile,
                        email,
                        password
                    )
                    VALUES (?, ?, ?, ?)
                `).run(
                    name,
                    mobile,
                    email,
                    hashedPassword
                );

            const customerId =
                Number(
                    result.lastInsertRowid
                );

            req.session.customerId =
                customerId;

            db.prepare(`
                INSERT INTO notifications
                (
                    customer_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                customerId,
                "Welcome to FIXBYTE",
                "Your FIXBYTE customer account has been created successfully."
            );

            res.json({
                success: true,
                message:
                    "Account created successfully."
            });

        } catch (error) {

            console.error(
                "Signup Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to create account."
            });

        }

    }
);

// =====================================================
// CUSTOMER LOGIN
// =====================================================

app.post(
    "/api/login",
    async (req, res) => {

        try {

            const login =
                clean(req.body.login);

            const password =
                String(
                    req.body.password || ""
                );

            if (
                !login ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Login and password are required."
                });

            }

            const customer =
                db.prepare(`
                    SELECT *
                    FROM customers
                    WHERE email = ?
                    OR mobile = ?
                `).get(
                    login.toLowerCase(),
                    login
                );

            if (!customer) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Account not found."
                });

            }

            const validPassword =
                await bcrypt.compare(
                    password,
                    customer.password
                );

            if (!validPassword) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect password."
                });

            }

            req.session.customerId =
                customer.id;

            res.json({
                success: true,
                message:
                    "Login successful.",

                customer: {
                    id: customer.id,
                    name: customer.name,
                    email: customer.email,
                    mobile: customer.mobile
                }
            });

        } catch (error) {

            console.error(
                "Customer Login Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to login."
            });

        }

    }
);

// =====================================================
// CURRENT CUSTOMER
// =====================================================

app.get(
    "/api/me",
    requireCustomer,
    (req, res) => {

        const customer =
            db.prepare(`
                SELECT
                    id,
                    name,
                    mobile,
                    email,
                    created_at
                FROM customers
                WHERE id = ?
            `).get(
                req.session.customerId
            );

        if (!customer) {

            req.session.destroy(
                () => {}
            );

            return res.status(401).json({
                success: false,
                message:
                    "Customer not found."
            });

        }

        res.json({
            success: true,
            customer
        });

    }
);

// =====================================================
// CUSTOMER LOGOUT
// =====================================================

app.post(
    "/api/logout",
    (req, res) => {

        req.session.destroy(
            error => {

                if (error) {

                    return res.status(500).json({
                        success: false,
                        message:
                            "Unable to logout."
                    });

                }

                res.clearCookie(
                    "connect.sid"
                );

                res.json({
                    success: true,
                    message:
                        "Logged out successfully."
                });

            }
        );

    }
);

// =====================================================
// CUSTOMER PROJECTS
// =====================================================

app.get(
    "/api/projects",
    requireCustomer,
    (req, res) => {

        const projects =
            db.prepare(`
                SELECT
                    id,
                    customer_id,
                    name,
                    description,
                    status,
                    progress,
                    total_amount,
                    paid_amount,
                    (
                        total_amount -
                        paid_amount
                    ) AS pending_amount,
                    due_date,
                    created_at,
                    updated_at
                FROM projects
                WHERE customer_id = ?
                ORDER BY created_at DESC
            `).all(
                req.session.customerId
            );

        res.json({
            success: true,
            projects
        });

    }
);

// =====================================================
// SINGLE CUSTOMER PROJECT
// =====================================================

app.get(
    "/api/projects/:id",
    requireCustomer,
    (req, res) => {

        const project =
            db.prepare(`
                SELECT *
                FROM projects
                WHERE id = ?
                AND customer_id = ?
            `).get(
                Number(req.params.id),
                req.session.customerId
            );

        if (!project) {

            return res.status(404).json({
                success: false,
                message:
                    "Project not found."
            });

        }

        const updates =
            db.prepare(`
                SELECT
                    id,
                    title,
                    message,
                    created_at
                FROM project_updates
                WHERE project_id = ?
                ORDER BY created_at DESC
            `).all(
                project.id
            );

        res.json({
            success: true,
            project,
            updates
        });

    }
);

// =====================================================
// CUSTOMER NOTIFICATIONS
// =====================================================

app.get(
    "/api/notifications",
    requireCustomer,
    (req, res) => {

        const notifications =
            db.prepare(`
                SELECT
                    id,
                    title,
                    message,
                    is_read,
                    created_at
                FROM notifications
                WHERE customer_id = ?
                ORDER BY created_at DESC
            `).all(
                req.session.customerId
            );

        res.json({
            success: true,
            notifications
        });

    }
);

app.post(
    "/api/notifications/:id/read",
    requireCustomer,
    (req, res) => {

        const result =
            db.prepare(`
                UPDATE notifications
                SET is_read = 1
                WHERE id = ?
                AND customer_id = ?
            `).run(
                Number(req.params.id),
                req.session.customerId
            );

        res.json({
            success: true,
            changed:
                result.changes
        });

    }
);

app.get(
    "/api/payments",
    requireCustomer,
    (req, res) => {

        const payments =
            db.prepare(`
                SELECT
                    p.id,
                    p.amount,
                    p.payment_method,
                    p.reference,
                    p.notes,
                    p.payment_date,
                    p.created_at,
                    p.project_id,

                    COALESCE(
                        pr.name,
                        'General Payment'
                    ) AS project_name,

                    COALESCE(
                        pr.total_amount,
                        0
                    ) AS total_amount,

                    COALESCE(
                        pr.paid_amount,
                        0
                    ) AS paid_amount,

                    MAX(
                        0,
                        COALESCE(
                            pr.total_amount,
                            0
                        ) -
                        COALESCE(
                            pr.paid_amount,
                            0
                        )
                    ) AS pending_amount

                FROM payments p

                LEFT JOIN projects pr
                    ON pr.id = p.project_id

                WHERE p.customer_id = ?

                ORDER BY
                    p.payment_date DESC,
                    p.id DESC
            `).all(
                req.session.customerId
            );

        const summary =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(total_amount),
                        0
                    ) AS total_amount,

                    COALESCE(
                        SUM(paid_amount),
                        0
                    ) AS paid_amount,

                    COALESCE(
                        SUM(
                            total_amount -
                            paid_amount
                        ),
                        0
                    ) AS pending_amount

                FROM projects

                WHERE customer_id = ?
            `).get(
                req.session.customerId
            );

        res.json({
            success: true,
            summary,
            payments
        });

    }
);

// =====================================================
// CUSTOMER INVOICE
// =====================================================

app.get(
    "/api/payments/:id/invoice",
    requireCustomer,
    (req, res) => {

        const invoice =
            db.prepare(`
                SELECT

                    p.id,
                    p.amount,
                    p.payment_method,
                    p.reference,
                    p.notes,
                    p.payment_date,
                    p.created_at,

                    c.name AS customer_name,
                    c.email AS customer_email,
                    c.mobile AS customer_mobile,

                    COALESCE(
                        pr.name,
                        'General Payment'
                    ) AS project_name,

                    COALESCE(
                        pr.description,
                        ''
                    ) AS project_description,

                    COALESCE(
                        pr.total_amount,
                        0
                    ) AS total_amount,

                    COALESCE(
                        pr.paid_amount,
                        0
                    ) AS paid_amount,

                    MAX(
                        0,
                        COALESCE(
                            pr.total_amount,
                            0
                        ) -
                        COALESCE(// =====================================================
// CUSTOMER PAYMENTS
// =====================================================

app.ge
                            pr.paid_amount,
                            0
                        )
                    ) AS pending_amount

                FROM payments p

                JOIN customers c
                    ON c.id = p.customer_id

                LEFT JOIN projects pr
                    ON pr.id = p.project_id

                WHERE p.id = ?
                AND p.customer_id = ?

            `).get(
                Number(req.params.id),
                req.session.customerId
            );

        if (!invoice) {

            return res.status(404).json({
                success: false,
                message:
                    "Invoice not found."
            });

        }

        const year =
            new Date(
                invoice.payment_date ||
                invoice.created_at
            ).getFullYear();

        invoice.invoice_number =
            `INV-${year}-${String(
                invoice.id
            ).padStart(4, "0")}`;

        res.json({
            success: true,
            invoice
        });

    }
);

// =====================================================
// CUSTOMER SUPPORT
// =====================================================

app.get(
    "/api/support",
    requireCustomer,
    (req, res) => {

        const tickets =
            db.prepare(`
                SELECT
                    id,
                    subject,
                    message,
                    status,
                    reply,
                    created_at,
                    updated_at
                FROM support_tickets
                WHERE customer_id = ?
                ORDER BY
                    updated_at DESC,
                    id DESC
            `).all(
                req.session.customerId
            );

        res.json({
            success: true,
            tickets
        });

    }
);

app.post(
    "/api/support",
    requireCustomer,
    (req, res) => {

        const subject =
            clean(req.body.subject);

        const message =
            clean(req.body.message);

        if (
            !subject ||
            !message
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Subject and message are required."
            });

        }

        const result =
            db.prepare(`
                INSERT INTO support_tickets
                (
                    customer_id,
                    subject,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                req.session.customerId,
                subject,
                message
            );

        db.prepare(`
            INSERT INTO notifications
            (
                customer_id,
                title,
                message
            )
            VALUES (?, ?, ?)
        `).run(
            req.session.customerId,
            "Support Request Received",
            `Your support ticket #${result.lastInsertRowid} has been received.`
        );

        res.json({
            success: true,
            message:
                "Support request submitted.",
            ticketId:
                result.lastInsertRowid
        });

    }
);

// =====================================================
// ADMIN LOGIN
// =====================================================

app.post(
    "/api/admin/login",
    (req, res) => {

        const login =
            clean(
                req.body.username ||
                req.body.email ||
                req.body.login
            );

        const password =
            String(
                req.body.password || ""
            );

        const ADMIN_USERNAME =
            "Abhishek";

        const ADMIN_EMAIL =
            "admin@fixbyte.in";

        const ADMIN_PASSWORD =
            "@Abhishek3002";

        if (
            (
                login === ADMIN_USERNAME ||
                login.toLowerCase() === ADMIN_EMAIL
            ) &&
            password === ADMIN_PASSWORD
        ) {

            req.session.isAdmin =
                true;

            return res.json({
                success: true,
                message:
                    "Admin login successful."
            });

        }

        return res.status(401).json({
            success: false,
            message:
                "Invalid username or password."
        });

    }
);

// =====================================================
// ADMIN LOGOUT
// =====================================================

app.post(
    "/api/admin/logout",
    requireAdmin,
    (req, res) => {

        req.session.isAdmin =
            false;

        res.json({
            success: true,
            message:
                "Admin logged out successfully."
        });

    }
);

// =====================================================
// ADMIN PAGE
// =====================================================

app.get(
    "/admin",
    (req, res) => {

        if (
            !req.session ||
            req.session.isAdmin !== true
        ) {

            return res.redirect(
                "/admin-login.html"
            );

        }

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "admin.html"
            )
        );

    }
);

// =====================================================
// ADMIN STATS
// =====================================================

app.get(
    "/api/admin/stats",
    requireAdmin,
    (req, res) => {

        const customers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
            `).get().count;

        const projects =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM projects
            `).get().count;

        const activeProjects =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM projects
                WHERE status NOT IN
                ('Completed', 'Cancelled')
            `).get().count;

        const supportTickets =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM support_tickets
                WHERE status != 'Resolved'
            `).get().count;

        res.json({
            success: true,
            customers,
            projects,
            activeProjects,
            supportTickets
        });

    }
);

// =====================================================
// ADMIN CUSTOMERS
// =====================================================

app.get(
    "/api/admin/customers",
    requireAdmin,
    (req, res) => {

        const customers =
            db.prepare(`
                SELECT
                    id,
                    name,
                    mobile,
                    email,
                    created_at
                FROM customers
                ORDER BY id DESC
            `).all();

        res.json({
            success: true,
            customers
        });

    }
);

// =====================================================
// ADMIN PROJECTS - LIST
// =====================================================

app.get(
    "/api/admin/projects",
    requireAdmin,
    (req, res) => {

        const projects =
            db.prepare(`
                SELECT
                    p.*,

                    c.name AS customer_name,
                    c.email AS customer_email,
                    c.mobile AS customer_mobile

                FROM projects p

                LEFT JOIN customers c
                    ON c.id = p.customer_id

                ORDER BY
                    p.created_at DESC,
                    p.id DESC
            `).all();

        res.json({
            success: true,
            projects
        });

    }
);

// =====================================================
// ADMIN PROJECT - CREATE
// =====================================================

app.post(
    "/api/admin/projects",
    requireAdmin,
    (req, res) => {

        try {

            const customerId =
                Number(
                    req.body.customer_id
                );

            const name =
                clean(req.body.name);

            const description =
                clean(req.body.description);

            const status =
                clean(req.body.status) ||
                "Planning";

            const progress =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Number(
                            req.body.progress
                        ) || 0
                    )
                );

            const totalAmount =
                Number(
                    req.body.total_amount ??
                    req.body.budget ??
                    0
                ) || 0;

            const dueDate =
                clean(
                    req.body.due_date ??
                    req.body.deadline
                );

            if (
                !customerId ||
                !name
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Customer and project name are required."
                });

            }

            const customer =
                db.prepare(`
                    SELECT id
                    FROM customers
                    WHERE id = ?
                `).get(
                    customerId
                );

            if (!customer) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Customer not found."
                });

            }

            const result =
                db.prepare(`
                    INSERT INTO projects
                    (
                        customer_id,
                        name,
                        description,
                        status,
                        progress,
                        total_amount,
                        paid_amount,
                        due_date
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                `).run(
                    customerId,
                    name,
                    description,
                    status,
                    progress,
                    totalAmount,
                    dueDate || null
                );

            db.prepare(`
                INSERT INTO notifications
                (
                    customer_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                customerId,
                "New Project Added",
                `Your project "${name}" has been added to your FIXBYTE account.`
            );

            res.json({
                success: true,
                message:
                    "Project created successfully.",
                projectId:
                    result.lastInsertRowid
            });

        } catch (error) {

            console.error(
                "Create Project Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to create project."
            });

        }

    }
);

// =====================================================
// ADMIN PROJECT - UPDATE
// =====================================================

app.put(
    "/api/admin/projects/:id",
    requireAdmin,
    (req, res) => {

        try {

            const id =
                Number(
                    req.params.id
                );

            const existing =
                db.prepare(`
                    SELECT *
                    FROM projects
                    WHERE id = ?
                `).get(id);

            if (!existing) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });

            }

            const name =
                clean(
                    req.body.name
                ) ||
                existing.name;

            const description =
                clean(
                    req.body.description
                );

            const status =
                clean(
                    req.body.status
                ) ||
                existing.status;

            const progress =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Number(
                            req.body.progress
                        ) ||
                        0
                    )
                );

            const totalAmount =
                Number(
                    req.body.total_amount ??
                    req.body.budget ??
                    existing.total_amount ??
                    0
                ) || 0;

            const dueDate =
                clean(
                    req.body.due_date ??
                    req.body.deadline ??
                    existing.due_date
                );

            const customerId =
                Number(
                    req.body.customer_id ??
                    existing.customer_id
                );

            db.prepare(`
                UPDATE projects

                SET
                    customer_id = ?,
                    name = ?,
                    description = ?,
                    status = ?,
                    progress = ?,
                    total_amount = ?,
                    due_date = ?,
                    updated_at = CURRENT_TIMESTAMP

                WHERE id = ?
            `).run(
                customerId,
                name,
                description,
                status,
                progress,
                totalAmount,
                dueDate || null,
                id
            );

            db.prepare(`
                INSERT INTO notifications
                (
                    customer_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                customerId,
                "Project Updated",
                `Your project "${name}" has been updated. Progress: ${progress}%.`
            );

            res.json({
                success: true,
                message:
                    "Project updated successfully."
            });

        } catch (error) {

            console.error(
                "Update Project Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to update project."
            });

        }

    }
);

// =====================================================
// ADMIN PROJECT - DELETE
// =====================================================

app.delete(
    "/api/admin/projects/:id",
    requireAdmin,
    (req, res) => {

        const id =
            Number(
                req.params.id
            );

        const project =
            db.prepare(`
                SELECT *
                FROM projects
                WHERE id = ?
            `).get(id);

        if (!project) {

            return res.status(404).json({
                success: false,
                message:
                    "Project not found."
            });

        }

        db.prepare(`
            DELETE FROM projects
            WHERE id = ?
        `).run(id);

        res.json({
            success: true,
            message:
                "Project deleted successfully."
        });

    }
);

// =====================================================
// ADMIN PROJECT UPDATES
// =====================================================

app.post(
    "/api/admin/projects/:id/updates",
    requireAdmin,
    (req, res) => {

        const projectId =
            Number(
                req.params.id
            );

        const title =
            clean(
                req.body.title
            );

        const message =
            clean(
                req.body.message
            );

        if (
            !title ||
            !message
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Title and message are required."
            });

        }

        const project =
            db.prepare(`
                SELECT *
                FROM projects
                WHERE id = ?
            `).get(projectId);

        if (!project) {

            return res.status(404).json({
                success: false,
                message:
                    "Project not found."
            });

        }

        const result =
            db.prepare(`
                INSERT INTO project_updates
                (
                    project_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                projectId,
                title,
                message
            );

        db.prepare(`
            INSERT INTO notifications
            (
                customer_id,
                title,
                message
            )
            VALUES (?, ?, ?)
        `).run(
            project.customer_id,
            title,
            message
        );

        res.json({
            success: true,
            message:
                "Project update added.",
            updateId:
                result.lastInsertRowid
        });

    }
);

// =====================================================
// ADMIN NOTIFICATIONS
// =====================================================

app.post(
    "/api/admin/notifications",
    requireAdmin,
    (req, res) => {

        const customerId =
            Number(
                req.body.customer_id
            );

        const title =
            clean(
                req.body.title
            );

        const message =
            clean(
                req.body.message
            );

        if (
            !customerId ||
            !title ||
            !message
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Customer, title and message are required."
            });

        }

        const customer =
            db.prepare(`
                SELECT id
                FROM customers
                WHERE id = ?
            `).get(
                customerId
            );

        if (!customer) {

            return res.status(404).json({
                success: false,
                message:
                    "Customer not found."
            });

        }

        const result =
            db.prepare(`
                INSERT INTO notifications
                (
                    customer_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                customerId,
                title,
                message
            );

        res.json({
            success: true,
            message:
                "Notification sent successfully.",
            notificationId:
                result.lastInsertRowid
        });

    }
);

// =====================================================
// ADMIN SUPPORT
// =====================================================

app.get(
    "/api/admin/support",
    requireAdmin,
    (req, res) => {

        const tickets =
            db.prepare(`
                SELECT
                    s.*,

                    c.name AS customer_name,
                    c.email AS customer_email,
                    c.mobile AS customer_mobile

                FROM support_tickets s

                LEFT JOIN customers c
                    ON c.id = s.customer_id

                ORDER BY
                    s.created_at DESC,
                    s.id DESC
            `).all();

        res.json({
            success: true,
            tickets
        });

    }
);

// =====================================================
// ADMIN SUPPORT UPDATE
// =====================================================

app.put(
    "/api/admin/support/:id",
    requireAdmin,
    (req, res) => {

        const id =
            Number(
                req.params.id
            );

        const ticket =
            db.prepare(`
                SELECT *
                FROM support_tickets
                WHERE id = ?
            `).get(id);

        if (!ticket) {

            return res.status(404).json({
                success: false,
                message:
                    "Support ticket not found."
            });

        }

        const status =
            clean(
                req.body.status
            ) ||
            ticket.status;

        const reply =
            clean(
                req.body.reply
            );

        db.prepare(`
            UPDATE support_tickets

            SET
                status = ?,
                reply = ?,
                updated_at = CURRENT_TIMESTAMP

            WHERE id = ?
        `).run(
            status,
            reply,
            id
        );

        if (reply) {

            db.prepare(`
                INSERT INTO notifications
                (
                    customer_id,
                    title,
                    message
                )
                VALUES (?, ?, ?)
            `).run(
                ticket.customer_id,
                "FIXBYTE Support Reply",
                reply
            );

        }

        res.json({
            success: true,
            message:
                "Support ticket updated."
        });

    }
);

// =====================================================
// ADMIN PAYMENTS - LIST
// =====================================================

app.get(
    "/api/admin/payments",
    requireAdmin,
    (req, res) => {

        try {

            const payments =
                db.prepare(`
                    SELECT

                        p.*,

                        c.name AS customer_name,
                        c.email AS customer_email,
                        c.mobile AS customer_mobile,

                        pr.name AS project_name

                    FROM payments p

                    LEFT JOIN customers c
                        ON c.id = p.customer_id

                    LEFT JOIN projects pr
                        ON pr.id = p.project_id

                    ORDER BY
                        p.payment_date DESC,
                        p.id DESC
                `).all();

            res.json({
                success: true,
                payments
            });

        } catch (error) {

            console.error(
                "Admin Payments Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load payments."
            });

        }

    }
);

// =====================================================
// ADMIN ADD PAYMENT
// =====================================================

app.post(
    "/api/admin/payments",
    requireAdmin,
    (req, res) => {

        try {

            const customerId =
                Number(
                    req.body.customer_id
                );

            const projectId =
                Number(
                    req.body.project_id
                );

            const amount =
                Number(
                    req.body.amount
                );

            const paymentMethod =
                clean(
                    req.body.payment_method
                ) ||
                "Cash";

            const reference =
                clean(
                    req.body.reference
                );

            const notes =
                clean(
                    req.body.notes
                );

            const paymentDate =
                clean(
                    req.body.payment_date
                ) ||
                new Date()
                    .toISOString();

            if (
                !customerId ||
                !projectId ||
                !amount ||
                amount <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Customer, project and valid amount are required."
                });

            }

            const customer =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        email,
                        mobile
                    FROM customers
                    WHERE id = ?
                `).get(
                    customerId
                );

            if (!customer) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Customer not found."
                });

            }

            const project =
                db.prepare(`
                    SELECT *
                    FROM projects
                    WHERE id = ?
                `).get(
                    projectId
                );

            if (!project) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });

            }

            if (
                Number(
                    project.customer_id
                ) !== customerId
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Selected project does not belong to this customer."
                });

            }

            const currentPaid =
                Number(
                    project.paid_amount
                ) || 0;

            const totalAmount =
                Number(
                    project.total_amount
                ) || 0;

            const pendingAmount =
                Math.max(
                    0,
                    totalAmount -
                    currentPaid
                );

            if (
                totalAmount > 0 &&
                amount > pendingAmount
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        `Maximum pending amount is ₹${money(pendingAmount)}.`
                });

            }

            const transaction =
                db.transaction(
                    () => {

                        const paymentResult =
                            db.prepare(`
                                INSERT INTO payments
                                (
                                    customer_id,
                                    project_id,
                                    amount,
                                    payment_method,
                                    reference,
                                    notes,
                                    payment_date
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                customerId,
                                projectId,
                                amount,
                                paymentMethod,
                                reference,
                                notes,
                                paymentDate
                            );const paymentId = transaction();

                        const newPaidAmount =
                            currentPaid +
                            amount;

                        db.prepare(`
                            UPDATE projects

                            SET
                                paid_amount = ?,
                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE id = ?
                        `).run(
                            newPaidAmount,
                            projectId
                        );

                        db.prepare(`
                            INSERT INTO notifications
                            (
                                customer_id,
                                title,
                                message
                            )
                            VALUES (?, ?, ?)
                        `).run(
                            customerId,
                            "Payment Received",
                            `₹${money(amount)} payment received for project "${project.name}".`
                        );

                        return (
                            paymentResult
                                .lastInsertRowid
                        );

                    }
                );

            res.json({
                success: true,
                message:
                    "Payment recorded successfully.",
                paymentId:
                    paymentid
            });

        } catch (error) {

            console.error(
                "Add Payment Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to record payment."
            });

        }

    }
);

// =====================================================
// ADMIN DELETE PAYMENT
// =====================================================

app.delete(
    "/api/admin/payments/:id",
    requireAdmin,
    (req, res) => {

        try {

            const paymentId =
                Number(
                    req.params.id
                );

            const payment =
                db.prepare(`
                    SELECT *
                    FROM payments
                    WHERE id = ?
                `).get(
                    paymentId
                );

            if (!payment) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Payment not found."
                });

            }

            db.transaction(
                () => {

                    db.prepare(`
                        DELETE FROM payments
                        WHERE id = ?
                    `).run(
                        paymentId
                    );

                    if (
                        payment.project_id
                    ) {

                        const totalPaid =
                            db.prepare(`
                                SELECT
                                    COALESCE(
                                        SUM(amount),
                                        0
                                    ) AS total
                                FROM payments
                                WHERE project_id = ?
                            `).get(
                                payment.project_id
                            ).total;

                        db.prepare(`
                            UPDATE projects

                            SET
                                paid_amount = ?,
                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE id = ?
                        `).run(
                            Number(
                                totalPaid
                            ) || 0,
                            payment.project_id
                        );

                    }

                }
            )();

            res.json({
                success: true,
                message:
                    "Payment deleted successfully."
            });

        } catch (error) {

            console.error(
                "Delete Payment Error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete payment."
            });

        }

    }
);

// =====================================================
// ADMIN PAYMENT INVOICE
// =====================================================

app.get(
    "/api/admin/payments/:id/invoice",
    requireAdmin,
    (req, res) => {

        const invoice =
            db.prepare(`
                SELECT

                    p.*,

                    c.name AS customer_name,
                    c.email AS customer_email,
                    c.mobile AS customer_mobile,

                    pr.name AS project_name,
                    pr.description AS project_description,
                    pr.total_amount,
                    pr.paid_amount,
                    pr.due_date

                FROM payments p

                LEFT JOIN customers c
                    ON c.id = p.customer_id

                LEFT JOIN projects pr
                    ON pr.id = p.project_id

                WHERE p.id = ?

            `).get(
                Number(
                    req.params.id
                )
            );

        if (!invoice) {

            return res.status(404).json({
                success: false,
                message:
                    "Invoice not found."
            });

        }

        const year =
            new Date(
                invoice.payment_date ||
                invoice.created_at
            ).getFullYear();

        invoice.invoice_number =
            `INV-${year}-${String(
                invoice.id
            ).padStart(4, "0")}`;

        invoice.pending_amount =
            Math.max(
                0,
                Number(
                    invoice.total_amount ||
                    0
                ) -
                Number(
                    invoice.paid_amount ||
                    0
                )
            );

        res.json({
            success: true,
            invoice
        });

    }
);

// =====================================================
// DASHBOARD PAGE
// =====================================================

app.get(
    "/dashboard",
    (req, res) => {

        if (
            !req.session ||
            !req.session.customerId
        ) {

            return res.redirect(
                "/login.html"
            );

        }

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "dashboard.html"
            )
        );

    }
);

// =====================================================
// SERVER START
// =====================================================

app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "===================================="
        );

        console.log(
            "       FIXBYTE WEBSITE RUNNING"
        );

        console.log(
            "===================================="
        );

        console.log(
            `Local: http://localhost:${PORT}`
        );

        console.log("");

        console.log(
            "Database: Connected"
        );

        console.log(
            "Authentication: Enabled"
        );

        console.log(
            "Admin Authentication: Enabled"
        );

        console.log(
            "Projects API: Enabled"
        );

        console.log(
            "Payments API: Enabled"
        );

        console.log(
            "Customer Invoice API: Enabled"
        );

        console.log(
            "Notifications API: Enabled"
        );

        console.log(
            "Support API: Enabled"
        );

        console.log(
            "Admin API: Enabled"
        );

        console.log(
            "===================================="
        );

    }
);