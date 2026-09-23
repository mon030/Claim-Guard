import { getCollections } from "../../../../../lib/mongodb";
import { activeRecords, ApiError, apiErrorResponse, photoObjectId } from "../../../../../lib/api/http";
import { requireDemoAccess, DEMO_HEADER } from "../../../../../lib/api/security";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireDemoAccess(request);
    const { id } = await context.params;
    const photoId = photoObjectId(id);
    const { photos } = await getCollections();
    const now = new Date();
    const photo = await photos.findOne({ _id: photoId, ...activeRecords(now) }, {
      projection: { thumbnail: 1, thumbnailContentType: 1, origin: 1, expiresAt: 1 }, timeoutMS: 1_000,
    });
    if (!photo?.thumbnail || photo.thumbnailContentType !== "image/jpeg") throw new ApiError(404, "photo_not_found", "Thumbnail not found or expired.");
    const remaining = photo.origin === "user" ? Math.max(0, Math.floor((photo.expiresAt.getTime() - now.getTime()) / 1000)) : 300;
    return new Response(new Uint8Array(photo.thumbnail.value()), { headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(photo.thumbnail.length()),
      "Cache-Control": `private, max-age=${Math.min(300, remaining)}, must-revalidate`,
      "Vary": DEMO_HEADER, "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiErrorResponse(error); }
}
