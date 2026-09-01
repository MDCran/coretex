import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

/** Public build/version info — handy for uptime checks and "what's deployed?". */
export function GET() {
    return NextResponse.json(APP_VERSION);
}
