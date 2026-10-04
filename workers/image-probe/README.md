# Images binding remote probe

This is an isolated **development probe**, not the Commerce 360 application.
It never stores submitted images and has no Supabase credentials. Run only with
Wrangler remote development and stop the session when the runner finishes:

```powershell
npx wrangler dev --remote --config workers/image-probe/wrangler.jsonc --ip 127.0.0.1 --port 8787
```

In another terminal:

```powershell
node workers/image-probe/run-probe.mjs http://127.0.0.1:8787/probe
```

The runner constructs private synthetic fixtures in memory and prints only
case names, outcomes and sanitized dimensions. It exits nonzero on any failed
contract assertion. It does not save images or credentials. `wrangler dev`
without `--remote` uses a limited local Images mock and cannot establish the
EXIF/orientation result. Do not run `wrangler deploy` for this probe.

The Worker imports the actual `processCatalogImageCloudflare` adapter. The
remote binding retained JPEG EXIF even when given an undocumented
`metadata: "none"` output option, so the adapter strips JPEG APP and COM
segments after the binding has applied orientation. The adapter also removes
PNG private ancillary chunks and WebP EXIF/XMP/ICC chunks from output bytes,
then asks the binding to decode the sanitized result before storage. The runner
checks both dimensions and color quadrants for EXIF orientation 6. Its PNG and
WebP inputs contain synthetic EXIF, XMP and ICC; PNG additionally has tEXt,
iTXt and zTXt. It verifies their absence in output, rejection of APNG and
animated WebP, malformed JPEG, the 10,000-pixel edge limit and the 5 MB input
limit. Application route integration and Supabase Storage upload are separate
gates.

The binding may count unique transformations under the account's Images Free
allowance. See [Cloudflare's binding guide](https://developers.cloudflare.com/images/optimization/binding/).
