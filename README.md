# ETH Timetable Splitter

A CLI tool for splitting ETH Zurich's MyStudies ICS timetable files into separate calendar files by course and event type (Lecture/Exercise/Seminar), with optional import to Google Calendar.

## Why?

ETH Zurich's MyStudies exports a single ICS file containing all your courses. This is fine if you want everything in one calendar, but often you want:
- Separate calendars for different courses (e.g., only Complex Network Models)
- Separate calendars for lecture vs exercise sessions (e.g., Automated Software Testing has both V= lecture and U= exercise)
- Import individual courses to Google Calendar

This tool solves that.

## Prerequisites

- [Bun](https://bun.sh/) runtime

## Setup

1. Clone this repo
2. Install dependencies:
   ```bash
   bun install
   ```

## Usage

### 1. Split ICS File

Split your ETH timetable ICS file into separate ICS files by course and event type:

```bash
bun run split
```

This reads `ETH_timetable_20260221.ics` (or your custom file) and creates separate ICS files in the `output/` directory.

To use a custom input file:
```bash
bun run split:file -- your-file.ics
```

Output files are named like:
- `Advanced_Systems_Lab_V.ics` (Lectures)
- `Automated_Software_Testing_V.ics` (Lectures)
- `Automated_Software_Testing_U.ics` (Exercises)

### 2. Import to Google Calendar

To import the split ICS files to Google Calendar, you need:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the **Google Calendar API**
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials** > **OAuth client ID**
6. Choose **Desktop application**
7. Download the JSON credentials file
8. Rename it to `credentials.json` and place it in the project root

Run the import:

```bash
bun run google-import
```

On first run:
1. You'll see a URL in the terminal
2. Open it in your browser
3. Complete the Google sign-in
4. Copy the redirect URL (the one starting with `http://localhost/?code=...`)
5. Paste it into the terminal

This creates a new Google Calendar for each ICS file and imports all events into it.

### 3. Delete Google Calendars

To delete the calendars created by this tool:

```bash
bun run google-delete
```

This:
- Scans the `output/` directory for ICS files
- Auto-selects calendars matching those files
- Shows a numbered list where you can select calendars to delete (e.g., `1,2,3` or `a` for all)

To auto-delete without prompting (for matching calendars only):
```bash
bun run google-delete:auto
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun run split` | Split ICS file into separate files by course/type |
| `bun run split:file -- <file.ics>` | Split a custom ICS file |
| `bun run google-import` | Import split ICS files to Google Calendar |
| `bun run google-delete` | Delete Google Calendars (interactive) |
| `bun run google-delete:auto` | Auto-delete matching calendars |

## Event Types

ETH uses these codes:
- **V** - Vorlesung (Lecture)
- **U** - Übung (Exercise)
- **G** - Grundlagen/Gruppe (Foundation/Group)
- **S** - Seminar

## Notes

- Calendars are created in your Google account, not shared
- Token is stored in `token.json` (auto-refreshed)
- Both `credentials.json` and `token.json` are gitignored
