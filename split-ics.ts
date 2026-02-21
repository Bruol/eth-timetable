#!/usr/bin/env bun

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

interface VEvent {
  dtstamp: string;
  dtstart: string;
  summary: string;
  dtend: string;
  description: string;
  location: string;
  uid: string;
}

function parseIcs(content: string): VEvent[] {
  const events: VEvent[] = [];
  const lines = content.split(/\r?\n/);

  let inEvent = false;
  let currentEvent: Partial<VEvent> = {};
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
        const key = currentField.toLowerCase() as keyof VEvent;
        (currentEvent as any)[key] = currentValue;
      }
      if (currentEvent.summary) {
        events.push(currentEvent as VEvent);
      }
    } else if (inEvent) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (currentField) {
          currentValue += line.slice(1);
        }
      } else {
        if (currentField && currentValue) {
          const key = currentField.toLowerCase() as keyof VEvent;
          (currentEvent as any)[key] = currentValue;
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

function parseSummary(summary: string): { courseName: string; type: string } {
  const match = summary.match(/^(.+?)\s*\((\w+)\)\s*.+$/);
  if (match) {
    return {
      courseName: match[1].trim(),
      type: match[2].trim(),
    };
  }
  return { courseName: summary, type: "Unknown" };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
}

function generateIcs(events: VEvent[]): string {
  const header = `BEGIN:VCALENDAR
PRODID:http://www.mystudies.ethz.ch
VERSION:2.0
CALSCALE:GREGORIAN
`;

  const footer = "END:VCALENDAR";

  const eventStrings = events.map((event) => {
    return `BEGIN:VEVENT
DTSTAMP:${event.dtstamp}
DTSTART:${event.dtstart}
SUMMARY:${event.summary}
DTEND:${event.dtend}
DESCRIPTION:${event.description}
LOCATION:${event.location}
UID:${event.uid}
END:VEVENT`;
  });

  return header + eventStrings.join("\n") + "\n" + footer;
}

function main() {
  const inputFile = process.argv[2] || "ETH_timetable_20260221.ics";

  if (!existsSync(inputFile)) {
    console.error(`Error: File '${inputFile}' not found`);
    process.exit(1);
  }

  const content = readFileSync(inputFile, "utf-8");
  const events = parseIcs(content);

  const grouped: Record<string, VEvent[]> = {};

  for (const event of events) {
    const { courseName, type } = parseSummary(event.summary);
    const key = `${courseName}_${type}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(event);
  }

  const outputDir = "output";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir);
  }

  console.log(`Found ${events.length} events across ${Object.keys(grouped).length} course+type combinations:\n`);

  for (const [key, evts] of Object.entries(grouped)) {
    const [courseName, type] = key.split("_");
    const filename = `${sanitizeFilename(courseName)}_${type}.ics`;
    const filepath = join(outputDir, filename);
    writeFileSync(filepath, generateIcs(evts));
    console.log(`  - ${courseName} (${type}): ${evts.length} events -> ${filename}`);
  }

  console.log(`\nDone! ICS files written to '${outputDir}/'`);
}

main();
