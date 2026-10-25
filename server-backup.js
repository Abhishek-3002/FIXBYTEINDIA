const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;

// ===============================
// DATABASE
// ===============================

const db = new Database(
    path.join(__dirname, "fixbyte.db")
);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

console.log("Database connected successfully.");


// ===============================
// MIDDLEWARE
// ===============================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


app.use(
    session({
        secret: "FIXBYTE_SECRET_2026",

        resave: false,

        saveUninitialized: false,

        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);


// ===============================
// STATIC WEBSITE
// ===============================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ===============================
// HOME PAGE
// ===============================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});


// ===============================
// SIGNUP
// ===============================

app.post("/api/signup", async (req, res) => {

    try {

        const {
            name,
            mobile,
            email,
            password
        } = req.body;


        // Check fields

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


        // Password length

        if (password.length < 6) {

            return res.status(400).json({

                success: false,

                message:
                    "Password must be at least 6 characters."

            });

        }


        // Check existing account

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


        // Hash password

        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );


        // Create account

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


        // Create session

        req.session.customerId =
            result.lastInsertRowid;


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

});


// ===============================
// LOGIN
// ===============================

app.post("/api/login", async (req, res) => {

    try {

        const {
            login,
            password
        } = req.body;


        // Check fields

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


        // Find customer

        const customer =
            db.prepare(`
                SELECT *
                FROM customers
                WHERE email = ?
                OR mobile = ?
            `).get(
                login,
                login
            );


        if (!customer) {

            return res.status(401).json({

                success: false,

                message:
                    "Account not found."

            });

        }


        // Check password

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


        // Create login session

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
            "Login Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to login."

        });

    }

});


// ===============================
// CURRENT CUSTOMER
// ===============================

app.get("/api/me", (req, res) => {

    // Check login

    if (!req.session.customerId) {

        return res.status(401).json({

            success: false,

            message:
                "Not logged in."

        });

    }


    // Find customer

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

        return res.status(401).json({

            success: false,

            message:
                "Customer not found."

        });

    }


    res.json({

        success: true,

        customer: customer

    });

});


// ===============================
// LOGOUT
// ===============================

app.post("/api/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {

            return res.status(500).json({

                success: false,

                message:
                    "Unable to logout."

            });

        }


        res.json({

            success: true,

            message:
                "Logged out successfully."

        });

    });

});


// ===============================
// PROTECTED DASHBOARD
// ===============================

app.get("/dashboard", (req, res) => {

    if (!req.session.customerId) {

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

});


// ===============================
// SERVER START
// ===============================

app.listen(PORT, () => {

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
        "API: Signup / Login / Me / Logout"
    );

    console.log(
        "===================================="
    );

});