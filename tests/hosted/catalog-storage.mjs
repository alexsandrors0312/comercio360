// Opt-in hosted Storage verification. Run only through scripts/catalog-hosted.ps1.
// Credentials, tokens, object paths and provider errors never enter the report.
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const PROJECT = "qiwblpmocldqbijbylwg";
const URL = `https://${PROJECT}.supabase.co`;
const ORG = "10000000-0000-4000-8000-000000000001";
const STORE = "10000000-0000-4000-8000-000000000011";
const BUCKET = "catalog-private";
const REPORT = `docs/CATALOGO_002_HOSPEDADO_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const results = [];
const fixture = {
  userId: null, membershipId: null, productId: null,
  path: null, replacementPath: null, strayPath: null,
};
let current = "preflight";
let admin;
let failed = false;

function requireValue(condition) {
  if (!condition) throw new Error("hosted assertion");
}
function value(response) {
  requireValue(response && !response.error && response.data);
  return response.data;
}
async function stage(name, operation) {
  current = name;
  await operation();
  results.push({ test: name, result: "PASS" });
  console.log(`PASS: ${name}`);
}
async function remove(table, column, id) {
  if (!id) return;
  const response = await admin.from(table).delete().eq(column, id);
  requireValue(!response.error);
}
async function activateCover(client, key, objectId, bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expiry = Math.floor(Date.now() / 1000) + 120;
  const payload = ["catalog-image-v1", ORG, STORE, fixture.productId, objectId,
    fixture.userId, "image/png", String(bytes.length), "8", "8", digest, String(expiry)].join("|");
  const mac = createHmac("sha256", key).update(payload, "utf8").digest("hex");
  value(await client.rpc("catalog_mark_image_attested", {
    p_organization_id: ORG, p_store_id: STORE, p_object_id: objectId,
    p_mime_type: "image/png", p_byte_size: bytes.length, p_width: 8, p_height: 8,
    p_sha256_hex: digest, p_expires_unix: expiry, p_mac_hex: mac,
  }));
  const product = value(await client.from("products").select("revision")
    .eq("id", fixture.productId).single());
  value(await client.rpc("catalog_set_cover", {
    p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
    p_expected_revision: product.revision, p_object_id: objectId,
  }));
}

try {
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL === URL);
  requireValue(readFileSync("supabase/.temp/project-ref", "utf8").trim() === PROJECT);
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"));
  requireValue(process.env.SUPABASE_SECRET_KEY?.length > 100);
  const encoded = process.env.CATALOG_IMAGE_ATTESTATION_KEY;
  requireValue(encoded && /^[A-Za-z0-9+/]{43}=$/.test(encoded));
  const key = Buffer.from(encoded, "base64");
  requireValue(key.length === 32 && key.toString("base64") === encoded);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  admin = createClient(URL, process.env.SUPABASE_SECRET_KEY, options);
  const userClient = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const unique = randomUUID();
  const email = `catalog.hosted.${unique}@example.test`;
  const password = randomBytes(24).toString("base64url");

  await stage("Conta fictícia temporária e vínculo de loja", async () => {
    const created = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
    fixture.userId = created.user?.id;
    requireValue(fixture.userId);
    value(await admin.from("profiles").insert({ id: fixture.userId, display_name: "Catálogo hospedado" }).select("id").single());
    const membership = value(await admin.from("memberships").insert({
      organization_id: ORG, user_id: fixture.userId, role: "manager",
    }).select("id").single());
    fixture.membershipId = membership.id;
    value(await admin.from("user_store_access").insert({
      organization_id: ORG, membership_id: fixture.membershipId, store_id: STORE,
    }).select("id").single());
    value(await userClient.auth.signInWithPassword({ email, password }));
  });

  await stage("Produto temporário administrativo", async () => {
    const product = value(await admin.from("products").insert({
      organization_id: ORG, name: `Hosted storage probe ${unique.slice(0, 8)}`,
    }).select("id,revision").single());
    fixture.productId = product.id;
  });
  await stage("Atualização autenticada simples", async () => {
    const product = value(await userClient.from("products").select("revision")
      .eq("id", fixture.productId).single());
    value(await userClient.rpc("catalog_update_product", {
      p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
      p_expected_revision: product.revision, p_name: `Hosted updated ${unique.slice(0, 8)}`,
      p_description: null, p_category_id: null, p_active: true,
    }));
  });
  await stage("Reserva autenticada de imagem", async () => {
    const reserved = value(await userClient.rpc("catalog_reserve_image", {
      p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
    }));
    const row = Array.isArray(reserved) ? reserved[0] : reserved;
    requireValue(row?.object_id && row?.object_path);
    fixture.objectId = row.object_id;
    fixture.path = row.object_path;
  });

  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2277aa" } })
    .png().toBuffer();
  await stage("Upload HTTP reservado no Storage", async () => {
    value(await userClient.storage.from(BUCKET).upload(fixture.path, bytes, {
      contentType: "image/png", upsert: false, cacheControl: "0",
    }));
    fixture.strayPath = `unreserved/${randomUUID()}`;
    const denied = await userClient.storage.from(BUCKET).upload(fixture.strayPath, bytes, {
      contentType: "image/png", upsert: false,
    });
    requireValue(denied.error);
    fixture.strayPath = null;
  });

  await stage("Objeto reservado sem leitura nem URL assinada", async () => {
    const download = await userClient.storage.from(BUCKET).download(fixture.path);
    requireValue(download.error);
    const signed = await userClient.storage.from(BUCKET).createSignedUrl(fixture.path, 60);
    requireValue(signed.error);
  });

  await stage("Atestação HMAC e vínculo da capa", async () => {
    await activateCover(userClient, key, fixture.objectId, bytes);
  });

  await stage("URL assinada lê bytes; rota pública permanece fechada", async () => {
    const signed = value(await userClient.storage.from(BUCKET).createSignedUrl(fixture.path, 60));
    requireValue(signed.signedUrl);
    const response = await fetch(signed.signedUrl);
    requireValue(response.ok);
    requireValue(Buffer.from(await response.arrayBuffer()).equals(bytes));
    const publicResponse = await fetch(`${URL}/storage/v1/object/public/${BUCKET}/${fixture.path}`);
    requireValue(!publicResponse.ok);
  });

  await stage("Substituição revoga leitura da capa anterior", async () => {
    const replacement = value(await userClient.rpc("catalog_reserve_image", {
      p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
    }));
    const row = Array.isArray(replacement) ? replacement[0] : replacement;
    requireValue(row?.object_id && row?.object_path);
    fixture.replacementPath = row.object_path;
    const replacementBytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#bb5522" },
    }).png().toBuffer();
    value(await userClient.storage.from(BUCKET).upload(row.object_path, replacementBytes, {
      contentType: "image/png", upsert: false, cacheControl: "0",
    }));
    await activateCover(userClient, key, row.object_id, replacementBytes);
    const oldSigned = await userClient.storage.from(BUCKET).createSignedUrl(fixture.path, 60);
    requireValue(oldSigned.error);
    const latest = value(await userClient.storage.from(BUCKET).createSignedUrl(row.object_path, 60));
    const response = await fetch(latest.signedUrl);
    requireValue(response.ok);
    requireValue(Buffer.from(await response.arrayBuffer()).equals(replacementBytes));
  });

  await stage("Revogação do vínculo bloqueia sessão já aberta", async () => {
    value(await admin.from("memberships").update({ active: false })
      .eq("id", fixture.membershipId).select("id").single());
    const denied = await userClient.storage.from(BUCKET)
      .createSignedUrl(fixture.replacementPath, 60);
    requireValue(denied.error);
    value(await admin.from("memberships").update({ active: true })
      .eq("id", fixture.membershipId).select("id").single());
    const restored = value(await userClient.storage.from(BUCKET)
      .createSignedUrl(fixture.replacementPath, 60));
    requireValue(restored.signedUrl);
  });

  await stage("Revogação impede nova URL assinada", async () => {
    const product = value(await userClient.from("products").select("revision")
      .eq("id", fixture.productId).single());
    value(await userClient.rpc("catalog_set_cover", {
      p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
      p_expected_revision: product.revision, p_object_id: null,
    }));
    const signed = await userClient.storage.from(BUCKET)
      .createSignedUrl(fixture.replacementPath || fixture.path, 60);
    requireValue(signed.error);
  });

  await stage("Concorrência CAS entre duas sessões reais", async () => {
    const secondary = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
    value(await secondary.auth.signInWithPassword({ email, password }));
    const product = value(await userClient.from("products").select("revision")
      .eq("id", fixture.productId).single());
    const update = (client, name) => client.rpc("catalog_update_product", {
      p_organization_id: ORG, p_store_id: STORE, p_product_id: fixture.productId,
      p_expected_revision: product.revision, p_name: name,
      p_description: null, p_category_id: null, p_active: true,
    });
    const responses = await Promise.all([
      update(userClient, `Hosted CAS A ${unique.slice(0, 8)}`),
      update(secondary, `Hosted CAS B ${unique.slice(0, 8)}`),
    ]);
    const outcomes = responses.map((response) => !response.error ? "ok" :
      response.error.code === "40001" ? "conflict" :
      response.error.code === "57014" ? "timeout" : "other");
    console.log(`CAS categories: ${outcomes.join(",")}`);
    if (outcomes.includes("other")) {
      const other = responses.find((response, index) => outcomes[index] === "other");
      const code = other?.error?.code;
      const safeCode = typeof code === "string" && /^[A-Z0-9]{5,12}$/.test(code)
        ? code : "unclassified";
      const safeStatus = Number.isInteger(other?.status) ? other.status : 0;
      console.log(`CAS diagnostic: code=${safeCode}, http=${safeStatus}`);
    }
    requireValue(outcomes.filter((item) => item === "ok").length === 1);
    requireValue(outcomes.filter((item) => item === "conflict").length === 1);
  });
} catch {
  failed = true;
  results.push({ test: current, result: "FAIL" });
  console.log(`FAIL: ${current}. Diagnóstico sensível omitido.`);
} finally {
  current = "Limpeza das fixtures temporárias";
  let cleanupFailed = false;
  if (admin) {
    try {
      // Keep the ledger, product and actor until every Storage removal succeeds.
      // They are needed for a safe retry if the Storage service is unavailable.
      for (const path of [fixture.path, fixture.replacementPath, fixture.strayPath].filter(Boolean)) {
        const response = await admin.storage.from(BUCKET).remove([path]);
        requireValue(!response.error);
      }
      await remove("product_images", "product_id", fixture.productId);
      await remove("catalog_image_objects", "product_id", fixture.productId);
      await remove("products", "id", fixture.productId);
      await remove("user_store_access", "membership_id", fixture.membershipId);
      await remove("memberships", "id", fixture.membershipId);
      await remove("profiles", "id", fixture.userId);
      if (fixture.userId) {
        const deleted = await admin.auth.admin.deleteUser(fixture.userId);
        requireValue(!deleted.error);
      }
    } catch {
      cleanupFailed = true;
      // Preserve the fixture for retry and explicitly report whether access was revoked.
      if (fixture.membershipId) {
        let revoked = false;
        try {
          const response = await admin.from("memberships")
            .update({ active: false }).eq("id", fixture.membershipId)
            .select("active").single();
          revoked = !response.error && response.data?.active === false;
        } catch { /* Keep the final FAIL and require manual inspection. */ }
        if (!revoked) console.log("FAIL: revogação do vínculo não confirmada; inspecionar conta temporária.");
      }
    }
  }
  if (cleanupFailed) failed = true;
  results.push({ test: current, result: cleanupFailed ? "FAIL" : "PASS" });
  console.log(`${cleanupFailed ? "FAIL" : "PASS"}: ${current}${cleanupFailed ? ". Conferir fixtures antes de repetir." : ""}`);
  writeFileSync(REPORT, JSON.stringify({
    project_ref: PROJECT, executed_at: new Date().toISOString(),
    environment: "hosted Supabase Auth/Postgres/Storage HTTP", tests: results,
  }, null, 2) + "\n");
  console.log(`Evidência sanitizada: ${REPORT}`);
  process.exitCode = failed ? 1 : 0;
}
