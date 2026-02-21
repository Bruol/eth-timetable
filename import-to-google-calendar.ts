#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function icsDateToRfc3339(icsDate: string): string {
  const match = icsDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  return icsDate;
}

interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

function parseIcsForGoogleCalendar(content: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const lines = content.split(/\r?\n/);

  let inEvent = false;
  let currentEvent: Partial<CalendarEvent> = {};
  let currentField: string | null = null;
  let currentValue = "";

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      currentEvent = {};
      currentField = null;
      currentValue = "";
    } else if (line === "END:VEVENT") {
      inEvent = false;
      if (currentField && currentValue) {
        if (currentField === "SUMMARY") currentEvent.summary = currentValue;
        else if (currentField === "DESCRIPTION") currentEvent.description = currentValue;
        else if (currentField === "LOCATION") currentEvent.location = currentValue;
        else if (currentField === "DTSTART") currentEvent.start = { dateTime: icsDateToRfc3339(currentValue), timeZone: "Europe/Zurich" };
        else if (currentField === "DTEND") currentEvent.end = { dateTime: icsDateToRfc3339(currentValue), timeZone: "Europe/Zurich" };
      }

      if (currentEvent.summary && currentEvent.start && currentEvent.end) {
        events.push(currentEvent as CalendarEvent);
      }
    } else if (inEvent) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (currentField) {
          currentValue += line.slice(1);
        }
      } else {
        if (currentField && currentValue) {
          if (currentField === "SUMMARY") currentEvent.summary = currentValue;
          else if (currentField === "DESCRIPTION") currentEvent.description = currentValue;
          else if (currentField === "LOCATION") currentEvent.location = currentValue;
          else if (currentField === "DTSTART") currentEvent.start = { dateTime: icsDateToRfc3339(currentValue), timeZone: "Europe/Zurich" };
          else if (currentField === "DTEND") currentEvent.end = { dateTime: icsDateToRfc3339(currentValue), timeZone: "Europe/Zurich" };
        }
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          currentField = line.slice(0, colonIndex);
          currentValue = line.slice(colonIndex + 1);
        }
      }
    }
  }

  return events;
}

async function loadOrRefreshToken(
  oauth2Client: OAuth2Client,
  tokenPath: string
): Promise<void> {
  if (existsSync(tokenPath)) {
    const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
    oauth2Client.setCredentials(token);
    
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      writeFileSync(tokenPath, JSON.stringify(credentials, null, 2));
      console.log("Token refreshed");
    }
  }
}

async function getAuthenticatedClient(
  credentialsPath: string,
  tokenPath: string
): Promise<OAuth2Client> {
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.web || credentials.installed;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  await loadOrRefreshToken(oauth2Client, tokenPath);

  if (!oauth2Client.credentials.access_token && !oauth2Client.credentials.refresh_token) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });

    console.log("\nAuthorize this app by visiting this URL:");
    console.log(authUrl);
    console.log("\n");

    const input = await new Promise<string>((resolve) => {
      process.stdout.write("Enter the redirect URL: ");
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });

    let code: string | null;
    try {
      const url = new URL(input);
      code = url.searchParams.get("code");
      if (!code) {
        throw new Error("No code found in URL");
      }
    } catch {
      code = input;
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log("Token stored to", tokenPath);
  }

  return oauth2Client;
}

async function createCalendar(
  calendar: any,
  name: string,
  description: string
): Promise<string> {
  const response = await calendar.calendars.insert({
    requestBody: {
      summary: name,
      description: description,
      timeZone: "Europe/Zurich",
    },
  });
  console.log(`Created calendar: ${name} (${response.data.id})`);
  return response.data.id!;
}

async function importEvents(
  calendar: any,
  calendarId: string,
  events: CalendarEvent[]
): Promise<void> {
  let imported = 0;
  for (const event of events) {
    try {
      await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      imported++;
    } catch (error: any) {
      console.error(`Failed to import event: ${event.summary}`);
      console.error(`  Start: ${event.start.dateTime}, End: ${event.end.dateTime}`);
      console.error(`  Error: ${error.response?.data?.error?.message || error.message}`);
    }
  }
  console.log(`Imported ${imported}/${events.length} events`);
}

async function main() {
  const credentialsPath = process.argv[2] || "credentials.json";
  const tokenPath = process.argv[3] || "token.json";
  const icsDir = process.argv[4] || "output";

  if (!existsSync(credentialsPath)) {
    console.error(`Error: Credentials file '${credentialsPath}' not found`);
    console.log("Please download OAuth credentials from Google Cloud Console:");
    console.log("  1. Go to https://console.cloud.google.com");
    console.log("  2. Create a project and enable Google Calendar API");
    console.log("  3. Create OAuth 2.0 credentials (Desktop app)");
    console.log("  4. Download the credentials JSON file");
    process.exit(1);
  }

  const oauth2Client = await getAuthenticatedClient(credentialsPath, tokenPath);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const files = readdirSync(icsDir).filter((f) => f.endsWith(".ics"));
  console.log(`\nFound ${files.length} ICS files in ${icsDir}\n`);

  for (const file of files) {
    const icsPath = join(icsDir, file);
    const content = readFileSync(icsPath, "utf-8");
    const events = parseIcsForGoogleCalendar(content);

    const calendarName = file.replace(".ics", "").replace(/_/g, " ");
    const calendarId = await createCalendar(calendar, calendarName, `Imported from ${file}`);
    await importEvents(calendar, calendarId, events);
    console.log("");
  }

  console.log("Done!");
}

main();
