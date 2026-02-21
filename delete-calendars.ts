#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from "fs";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

interface CalendarItem {
  id: string;
  summary: string;
  selected: boolean;
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

  return oauth2Client;
}

function getCalendarNamesFromOutputDir(outputDir: string): string[] {
  if (!existsSync(outputDir)) {
    return [];
  }
  
  return readdirSync(outputDir)
    .filter(f => f.endsWith('.ics'))
    .map(f => f.replace('.ics', '').replace(/_/g, ' '));
}

function normalizeCalendarName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function calendarsMatch(calendarName: string, icsName: string): boolean {
  const normalizedCal = normalizeCalendarName(calendarName);
  const normalizedIcs = normalizeCalendarName(icsName);
  return normalizedCal.includes(normalizedIcs) || normalizedIcs.includes(normalizedCal);
}

function promptWithDefaults(message: string, defaultValue: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${message} [${defaultValue}]: `, (answer: string) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function checkboxPrompt(items: CalendarItem[]): Promise<CalendarItem[]> {
  console.log("\n  Select calendars to delete (enter numbers separated by commas, 'a' for all, 'none' for nothing):\n");
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const marker = item.selected ? "●" : "○";
    console.log(`  ${String(i + 1).padStart(2)} ${marker} ${item.summary}`);
  }
  
  console.log("");
  const selection = await promptWithDefaults("Selection", "");
  
  if (selection.toLowerCase() === 'a' || selection.toLowerCase() === 'all') {
    for (const item of items) {
      item.selected = true;
    }
  } else if (selection.toLowerCase() === 'none' || selection.trim() === '') {
    // Keep current selection
  } else {
    const selectedIndices = new Set<number>();
    for (const part of selection.split(',')) {
      const num = parseInt(part.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= items.length) {
        selectedIndices.add(num - 1);
      }
    }
    for (let i = 0; i < items.length; i++) {
      items[i].selected = selectedIndices.has(i);
    }
  }
  
  return items;
}

async function deleteCalendar(
  calendar: any,
  calendarId: string,
  summary: string
): Promise<void> {
  try {
    await calendar.calendars.delete({ calendarId });
    console.log(`Deleted: ${summary}`);
  } catch (error: any) {
    console.error(`Failed to delete ${summary}: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const credentialsPath = args[0] || "credentials.json";
  const tokenPath = args[1] || "token.json";
  const outputDir = args[2] || "output";
  
  const autoDelete = args.includes('--auto') || args.includes('-a');

  if (!existsSync(credentialsPath)) {
    console.error(`Error: Credentials file '${credentialsPath}' not found`);
    process.exit(1);
  }

  if (!existsSync(tokenPath)) {
    console.error(`Error: Token file '${tokenPath}' not found. Run import script first.`);
    process.exit(1);
  }

  const icsNames = getCalendarNamesFromOutputDir(outputDir);
  console.log(`Found ${icsNames.length} ICS files in ${outputDir}`);
  
  if (icsNames.length > 0) {
    console.log(`Auto-selecting matching calendars: ${icsNames.join(', ')}\n`);
  }

  const oauth2Client = await getAuthenticatedClient(credentialsPath, tokenPath);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  console.log("Fetching your calendars...\n");
  const response = await calendar.calendarList.list();
  const calendars = response.data.items || [];

  const items: CalendarItem[] = calendars.map((cal: any) => ({
    id: cal.id!,
    summary: cal.summary || cal.id,
    selected: icsNames.some(icsName => calendarsMatch(cal.summary || '', icsName)),
  }));

  if (items.length === 0) {
    console.log("No calendars found.");
    return;
  }

  let toDelete: CalendarItem[];
  
  if (autoDelete) {
    toDelete = items.filter(item => item.selected);
    if (toDelete.length === 0) {
      console.log("No matching calendars found.");
      return;
    }
    console.log(`Auto-deleting ${toDelete.length} matching calendar(s)...\n`);
  } else {
    const selectedItems = await checkboxPrompt(items);
    toDelete = selectedItems.filter(item => item.selected);

    if (toDelete.length === 0) {
      console.log("No calendars selected. Bye!");
      return;
    }
  }

  console.log(`\nDeleting ${toDelete.length} calendar(s)...\n`);
  
  for (const item of toDelete) {
    await deleteCalendar(calendar, item.id, item.summary);
  }

  console.log("\nDone!");
}

main();
