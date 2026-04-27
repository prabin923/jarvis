import { NextResponse } from "next/server";
import os from "os";
import { execSync } from "child_process";

function getCPUUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as any)[type];
    }
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

function getDiskInfo(): { total: string; used: string; free: string; percent: number } {
  try {
    const output = execSync("df -h / | tail -1", { encoding: "utf-8" });
    const parts = output.trim().split(/\s+/);
    return {
      total: parts[1] || "N/A",
      used: parts[2] || "N/A",
      free: parts[3] || "N/A",
      percent: parseInt(parts[4]) || 0,
    };
  } catch {
    return { total: "N/A", used: "N/A", free: "N/A", percent: 0 };
  }
}

function getBattery(): { percent: number; charging: boolean; timeRemaining: string } | null {
  try {
    const output = execSync("pmset -g batt", { encoding: "utf-8" });
    const match = output.match(/(\d+)%/);
    const charging = output.includes("AC Power") || output.includes("charging");
    const timeMatch = output.match(/(\d+:\d+) remaining/);
    return {
      percent: match ? parseInt(match[1]) : 0,
      charging,
      timeRemaining: timeMatch ? timeMatch[1] : charging ? "Charging" : "N/A",
    };
  } catch {
    return null;
  }
}

function getActiveProcesses(): { name: string; cpu: string; mem: string }[] {
  try {
    const output = execSync("ps -eo pcpu,pmem,comm -r | head -8", { encoding: "utf-8" });
    const lines = output.trim().split("\n").slice(1);
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts.slice(2).join(" ").split("/").pop()?.slice(0, 30) || "unknown",
        cpu: parts[0] + "%",
        mem: parts[1] + "%",
      };
    });
  } catch {
    return [];
  }
}

function getUptime(): string {
  const seconds = os.uptime();
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export async function GET() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const data = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      osVersion: os.release(),
      uptime: getUptime(),
      cpu: {
        model: os.cpus()[0]?.model || "Unknown",
        cores: os.cpus().length,
        usage: getCPUUsage(),
      },
      memory: {
        total: (totalMem / 1073741824).toFixed(1) + " GB",
        used: (usedMem / 1073741824).toFixed(1) + " GB",
        free: (freeMem / 1073741824).toFixed(1) + " GB",
        percent: Math.round((usedMem / totalMem) * 100),
      },
      disk: getDiskInfo(),
      battery: getBattery(),
      processes: getActiveProcesses(),
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("System API Error:", error);
    return NextResponse.json({ error: "Failed to retrieve system metrics." }, { status: 500 });
  }
}
