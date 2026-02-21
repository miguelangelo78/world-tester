import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "..", "..", "data", "screenshots");

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  const sanitized = path.basename(filePath);
  const fullPath = path.join(SCREENSHOTS_DIR, sanitized);

  // Prevent directory traversal
  if (!fullPath.startsWith(SCREENSHOTS_DIR)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  try {
    const buffer = await readFile(fullPath);
    const ext = path.extname(sanitized).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 });
  }
}
