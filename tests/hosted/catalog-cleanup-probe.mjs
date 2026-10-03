import { randomUUID } from "node:crypto";
import { runCatalogImageCleanup } from "../../scripts/catalog-image-cleanup.mjs";

function check(condition) {
  if (!condition) throw new Error("hosted cleanup assertion");
}

// All old rows belong to this run's temporary product. No trigger is disabled
// and no timestamp of an existing object is changed to make it eligible.
export async function verifyHostedCleanup({
  projectUrl,
  admin,
  organizationId,
  productId,
  userId,
  stage,
  recordPath,
}) {
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const objects = ["cleanup_pending", "deleting", "active"].map((state) => {
    const id = randomUUID();
    return {
      id,
      organization_id: organizationId,
      product_id: productId,
      actor_user_id: userId,
      object_path: `${organizationId}/${productId}/${id}`,
      state,
      created_at: old,
      updated_at: old,
    };
  });
  await stage(
    "Worker real remove objeto vencido e retoma objeto já ausente",
    async () => {
      for (const row of objects) {
        recordPath(row.object_path);
        const inserted = await admin.from("catalog_image_objects").insert(row);
        check(!inserted.error);
        if (row.state !== "deleting") {
          const uploaded = await admin.storage
            .from("catalog-private")
            .upload(
              row.object_path,
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i0AAAAASUVORK5CYII=",
                "base64",
              ),
              { contentType: "image/png", upsert: false },
            );
          check(!uploaded.error);
        }
      }
      const active = objects[2];
      const link = await admin.from("product_images").insert({
        organization_id: organizationId,
        product_id: productId,
        object_id: active.id,
      });
      check(!link.error);
      const ledger = await admin
        .from("catalog_image_objects")
        .select("id,product_id,state,updated_at");
      check(
        !ledger.error &&
          ledger.data.every((row) => row.product_id === productId),
      );
      const eligible = ledger.data.filter(
        (row) =>
          ["reserved", "uploaded", "cleanup_pending", "deleting"].includes(
            row.state,
          ) &&
          new Date(row.updated_at).getTime() < Date.now() - 2 * 60 * 60 * 1000,
      );
      check(
        eligible.length === 2 &&
          eligible.every((row) =>
            objects.slice(0, 2).some((item) => item.id === row.id),
          ),
      );
      const result = await runCatalogImageCleanup({
        NEXT_PUBLIC_SUPABASE_URL: projectUrl,
        CONFIRM_SUPABASE_PROJECT_URL: projectUrl,
        ALLOW_CATALOG_IMAGE_CLEANUP: "yes",
        SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      });
      check(
        result.claimed === 2 && result.deleted === 2 && result.failed === 0,
      );
      console.log(
        `Worker counts: claimed=${result.claimed}, deleted=${result.deleted}, failed=${result.failed}`,
      );
      const after = await admin
        .from("catalog_image_objects")
        .select("id,state")
        .eq("product_id", productId);
      check(
        !after.error &&
          objects
            .slice(0, 2)
            .every((row) =>
              after.data.some(
                (item) => item.id === row.id && item.state === "deleted",
              ),
            ),
      );
      check(
        after.data.some(
          (row) => row.id === active.id && row.state === "active",
        ),
      );
      for (const prior of ledger.data.filter(
        (row) => !objects.some((item) => item.id === row.id),
      ))
        check(
          after.data.some(
            (row) => row.id === prior.id && row.state === prior.state,
          ),
        );
      const retained = await admin.storage
        .from("catalog-private")
        .download(active.object_path);
      check(!retained.error && retained.data);
      for (const row of objects.slice(0, 2)) {
        const gone = await admin.storage
          .from("catalog-private")
          .download(row.object_path);
        check(gone.error);
      }
    },
  );
}
