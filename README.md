# Remote Work Timer

A time tracking app for remote work — track tasks, log hours, and export reports to get paid.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the app
npm start
```

Open **http://localhost:3000** in your browser. That's it.

For development with auto-reload on file changes:

```bash
npm run dev
```

To use a custom port:

```bash
PORT=8080 npm start
```

## How to Use

### 1. Create a Project

Click **+ New Project** on the dashboard. Give it a name, set an hourly rate (for billing), and pick a color.

### 2. Add Tasks

Open a project and type a task name (e.g. "API integration", "Bug fixes") then click **Add**.

### 3. Track Time

- **Start a timer** — Click the play button on any task. A timer bar appears at the top showing elapsed time.
- **Stop the timer** — Click **Stop** in the timer bar or on the task itself.
- **Add time manually** — Use the "Add Entry" button on a task to log hours you forgot to track.

Only one timer can run at a time. Starting a new one automatically stops the previous one.

### 4. View Reports

Switch to the **Reports** tab, pick a date range, and click **Generate**. You'll see:

- Hours per project
- Earnings per project (based on hourly rates)
- A detailed breakdown of every time entry

Click **Export CSV** to download the report for invoicing.

## Data Storage

All data is stored locally in a SQLite database file (`timetracker.db`) created automatically in the project folder. No account or internet connection required.

## License

CC0-1.0 — Public domain.
