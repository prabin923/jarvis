import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";

interface NetworkDevice {
  ip: string;
  mac: string;
  hostname: string;
  vendor: string;
  type: "router" | "computer" | "phone" | "iot" | "unknown";
}

function getLocalIP(): { ip: string; interface: string; subnet: string } {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return { ip: addr.address, interface: name, subnet: addr.netmask };
      }
    }
  }
  return { ip: "127.0.0.1", interface: "lo0", subnet: "255.255.255.0" };
}

function getARPTable(): NetworkDevice[] {
  try {
    const output = execSync("arp -a", { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n");
    const devices: NetworkDevice[] = [];

    for (const line of lines) {
      // Format: hostname (IP) at MAC on interface [type]
      const match = line.match(/^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+(\S+)/);
      if (match && match[3] !== "(incomplete)") {
        const hostname = match[1] === "?" ? "" : match[1];
        const ip = match[2];
        const mac = match[3].toUpperCase();

        devices.push({
          ip,
          mac,
          hostname,
          vendor: guessVendor(mac),
          type: guessDeviceType(mac, hostname),
        });
      }
    }

    return devices;
  } catch {
    return [];
  }
}

function guessVendor(mac: string): string {
  const prefix = mac.replace(/:/g, "").slice(0, 6).toUpperCase();
  const vendors: Record<string, string> = {
    "A4CF12": "Apple", "3C22FB": "Apple", "F0D4F6": "Apple", "AC87A3": "Apple",
    "88E9FE": "Apple", "A860B6": "Apple", "F8FF0A": "Apple", "DC56E7": "Apple",
    "7CD1C3": "Apple", "A4B197": "Apple", "3CE072": "Apple", "687D6B": "Apple",
    "B8E856": "Apple", "1C36BB": "Apple",
    "B4A9FC": "Samsung", "A0B4A5": "Samsung", "8C:71:F8": "Samsung",
    "302303": "TP-Link", "B0BE76": "TP-Link", "EC086B": "TP-Link",
    "00E04C": "Realtek", "48EE0C": "Realtek",
    "DC4427": "Intel", "F8633F": "Intel", "5CE0C5": "Intel",
    "18AF8F": "Xiaomi", "641331": "Xiaomi", "9C2EA1": "Xiaomi",
    "B827EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi",
    "A44CC8": "Dell", "F48E38": "Dell",
    "001A2B": "Cisco", "002255": "Cisco",
    "2C3361": "HP", "9457A5": "HP",
    "FCF5C4": "OPPO", "B47C9C": "OPPO",
    "645A04": "Huawei", "5C7D5E": "Huawei",
  };

  return vendors[prefix] || "Unknown";
}

function guessDeviceType(mac: string, hostname: string): "router" | "computer" | "phone" | "iot" | "unknown" {
  const hn = hostname.toLowerCase();
  const vendor = guessVendor(mac).toLowerCase();

  if (hn.includes("router") || hn.includes("gateway") || hn.includes("tp-link") || hn.includes("netgear")) return "router";
  if (hn.includes("iphone") || hn.includes("android") || hn.includes("galaxy") || hn.includes("pixel") || hn.includes("oneplus")) return "phone";
  if (hn.includes("macbook") || hn.includes("laptop") || hn.includes("desktop") || hn.includes("pc") || hn.includes("imac")) return "computer";
  if (hn.includes("alexa") || hn.includes("echo") || hn.includes("nest") || hn.includes("ring") || hn.includes("cam")) return "iot";

  if (vendor === "tp-link" || vendor === "cisco" || vendor === "netgear") return "router";
  if (vendor === "samsung" || vendor === "xiaomi" || vendor === "oppo" || vendor === "huawei") return "phone";
  if (vendor === "apple") return "computer";
  if (vendor === "raspberry pi") return "iot";

  return "unknown";
}

function getWifiInfo(): { ssid: string; signal: string } | null {
  try {
    // Try networksetup first (most compatible)
    const ssid = execSync(
      "networksetup -getairportnetwork en0 | sed 's/Current Wi-Fi Network: //'",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    
    // Try to get signal strength via system_profiler
    let signal = "N/A";
    try {
      const profilerOutput = execSync(
        "system_profiler SPAirPortDataType 2>/dev/null | grep -i 'signal' | head -1 | awk '{print $NF}'",
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (profilerOutput) signal = `${profilerOutput} dBm`;
    } catch {}

    return { ssid: ssid || "Unknown", signal };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const local = getLocalIP();
    const devices = getARPTable();
    const wifi = getWifiInfo();

    return NextResponse.json({
      localDevice: {
        ip: local.ip,
        interface: local.interface,
        hostname: os.hostname(),
      },
      wifi,
      devices,
      totalDevices: devices.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Network API Error:", error);
    return NextResponse.json({ error: "Failed to perform network scan." }, { status: 500 });
  }
}
