# Translator Access

Translator login for `https://translate.grimoiremods.com` is controlled by the
Cloudflare Access application named `Grimoire Translate`.

Do not add email-based translators to the D1 `contributors` table. That table is
for Steam-authenticated live translation suggestions and contributor roles. The
email allowlist lives in the Cloudflare Access policy named
`Grimoire translators`.

## Add A Translator

Required:

- The translator email from the Discord ticket.
- A Cloudflare API token with Zero Trust Access application and policy write
  permission.
- The Cloudflare account id.

Use one of the two methods below.

## Dashboard Method

1. Open Cloudflare Zero Trust.
2. Go to Access, then Applications.
3. Open `Grimoire Translate`.
4. Do not edit `Grimoire Translate Live API`; that application bypasses only the
   public live translation API.
5. Open the `Grimoire translators` policy.
6. Add an Include rule for `Emails` with the requested email address.
7. Save the policy.
8. Reply in the Discord ticket that access has been added.

## API Method

From this workspace, the admin project usually has the needed local values in
`../grimoire-admin/.dev.vars`. Load them without printing the token:

```sh
export CLOUDFLARE_ACCOUNT_ID="$(awk -F= '/^CF_ACCOUNT_ID=/{print $2}' ../grimoire-admin/.dev.vars)"
export CLOUDFLARE_API_TOKEN="$(awk -F= '/^CF_API_TOKEN=/{print $2}' ../grimoire-admin/.dev.vars)"
export TRANSLATOR_EMAIL="person@example.com"
```

Then run:

```sh
node --input-type=module <<'NODE'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const email = process.env.TRANSLATOR_EMAIL?.trim().toLowerCase();

if (!accountId || !token || !email) {
  throw new Error('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and TRANSLATOR_EMAIL first');
}

async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const body = await response.json();
  if (!response.ok || body.success === false) {
    const message = (body.errors ?? []).map((error) => error.message).join('; ') || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return body.result;
}

function policyHasEmail(policy) {
  return [...(policy.include ?? []), ...(policy.require ?? []), ...(policy.exclude ?? [])].some(
    (rule) => rule.email?.email?.toLowerCase() === email
  );
}

const apps = await cloudflare('/access/apps?per_page=100');
const app = apps.find((item) => item.name === 'Grimoire Translate');
if (!app) throw new Error('Could not find the Grimoire Translate Access application');

const policies = await cloudflare(`/access/apps/${app.id}/policies?per_page=100`);
const policySummary = policies.find((item) => item.name === 'Grimoire translators');
if (!policySummary) throw new Error('Could not find the Grimoire translators policy');

const policy = await cloudflare(`/access/apps/${app.id}/policies/${policySummary.id}`);
if (!policyHasEmail(policy)) {
  const include = [...(policy.include ?? []), { email: { email } }];
  await cloudflare(`/access/apps/${app.id}/policies/${policy.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: policy.name,
      decision: policy.decision,
      precedence: policy.precedence,
      include,
      require: policy.require ?? [],
      exclude: policy.exclude ?? [],
    }),
  });
}

const verified = await cloudflare(`/access/apps/${app.id}/policies/${policy.id}`);
console.log(policyHasEmail(verified) ? `added ${email}` : `failed to verify ${email}`);
NODE
```

Expected output:

```text
added person@example.com
```

Finally, reply in the Discord ticket that access has been added.
