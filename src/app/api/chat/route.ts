import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "");

const JARVIS_SYSTEM = `You are JARVIS — Just A Rather Very Intelligent System — an advanced AI assistant inspired by Tony Stark's AI.

PERSONALITY:
- You are confident, precise, and slightly witty — never overly formal
- You address the user as "Sir" or "Boss" occasionally  
- You have deep knowledge of technology, physics, engineering, and general science
- You are proactive: if something looks wrong (high CPU, suspicious network device), mention it
- You speak concisely — your responses should be clear and actionable
- You can engage in casual conversation but always maintain competence

CAPABILITIES:
- You have REAL-TIME access to the user's system: CPU, RAM, disk, battery, running processes
- You can see ALL devices connected to the local network (via ARP scan)
- You know the user's hostname, OS, architecture, and uptime
- When asked about system status, you analyze the provided data and give insights
- When asked about network, you report connected devices with vendor/type info

RESPONSE STYLE:
- When presenting system data, format it cleanly but don't just dump raw numbers
- Give context: "CPU at 45% — well within normal range for your workload"
- Flag anomalies: "I notice an unknown device on your network at 192.168.1.105"
- Be conversational, not robotic

KNOWLEDGE:
- Deep knowledge of theoretical physics, quantum mechanics, AI, and engineering
- Can explain complex topics clearly
- References actual science when discussing speculative topics
- Occasionally notes what remains unsolved in physics

RULES:
- NEVER fabricate system data — only report what's provided in the context
- If no system data is provided, say you need to run a scan first
- Keep responses under 200 words unless the user asks for detail`;

export async function POST(req: Request) {
  try {
    const { message, systemData, networkData, history } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    // Build context with live system data
    let context = "";
    if (systemData) {
      context += `\n[LIVE SYSTEM DATA]
Host: ${systemData.hostname} | OS: ${systemData.platform} ${systemData.arch} | Uptime: ${systemData.uptime}
CPU: ${systemData.cpu?.model} (${systemData.cpu?.cores} cores, ${systemData.cpu?.usage}% usage)
Memory: ${systemData.memory?.used} / ${systemData.memory?.total} (${systemData.memory?.percent}%)
Disk: ${systemData.disk?.used} / ${systemData.disk?.total} (${systemData.disk?.percent}%)
${systemData.battery ? `Battery: ${systemData.battery.percent}% (${systemData.battery.charging ? "Charging" : systemData.battery.timeRemaining + " remaining"})` : "Battery: N/A (desktop)"}
Top Processes: ${systemData.processes?.slice(0, 5).map((p: any) => `${p.name}(${p.cpu})`).join(", ") || "N/A"}`;
    }

    if (networkData) {
      context += `\n[NETWORK SCAN]
Local IP: ${networkData.localDevice?.ip} | WiFi: ${networkData.wifi?.ssid || "N/A"} (${networkData.wifi?.signal || "N/A"})
Connected Devices (${networkData.totalDevices}):
${networkData.devices?.map((d: any) => `  - ${d.ip} | ${d.mac} | ${d.vendor} | ${d.type}${d.hostname ? ` | ${d.hostname}` : ""}`).join("\n") || "None detected"}`;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      systemInstruction: JARVIS_SYSTEM,
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
    });

    const chatHistory = (history || []).slice(-10).map((m: any) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: chatHistory });
    const prompt = context ? `${context}\n\n[USER]: ${message}` : `[USER]: ${message}`;

    const result = await chat.sendMessage(prompt);
    const reply = result.response.text().trim();

    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error("JARVIS Error:", error);
    return NextResponse.json({ error: "An error occurred while processing your request." }, { status: 500 });
  }
}
