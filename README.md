# Instagram channel for Dynamics 365 Omnichannel

Bring **Instagram Direct messages** into **Dynamics 365 Omnichannel for Customer Service** — even though Instagram is not an officially supported channel.

This package is a small **relay service** that sits between Instagram and Dynamics 365 and translates messages both ways. It is designed so a **non‑technical person can deploy it with one click** in the Azure portal: no code, no command line, no Docker.

---

## How it works

Dynamics 365 Omnichannel has no built‑in Instagram connector and no place to run custom code. The only supported way to add a channel is the **Direct Line custom messaging channel**, which needs a piece of middleware to talk to Instagram. That middleware is this relay, and it runs in **your own Azure subscription**.

```mermaid
flowchart LR
    IG[Instagram / Meta<br/>Graph API + Webhooks] <-->|webhook in / Send API out| Relay[Relay service<br/>Azure Container Apps]
    Relay <-->|Direct Line 3.0| OC[D365 Omnichannel<br/>custom channel]
    OC --> Agent[Agent in Customer<br/>Service workspace]
```

* A customer sends an Instagram DM → Meta calls the relay's **webhook** → the relay opens a **Direct Line** conversation → it routes to an agent.
* The agent replies in Dynamics 365 → Direct Line delivers it to the relay → the relay calls the **Instagram Send API** → the customer sees the reply.

---

## Deploy it (the easy way)

> One‑time: an administrator publishes this repo and its prebuilt image once (see **Maintainer setup** below). After that, every customer uses the button.

### 1. Click the button

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#blade/Microsoft_Azure_CreateUIDef/CustomDeploymentBlade/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fmoliveirapinto%2Fd365-instagram-channel%2Fmain%2Finfra%2Fazuredeploy.json/createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Fmoliveirapinto%2Fd365-instagram-channel%2Fmain%2Finfra%2FcreateUiDefinition.json)

### 2. Follow the guided form

The portal opens a **step‑by‑step wizard**. Each tab has plain‑language help and a link to the matching guide, so you can't get lost. You only need five values:

| Tab | Field | Where it comes from |
| --- | --- | --- |
| Instagram keys | Instagram account ID | Your Instagram professional account — see [docs/01-meta-setup.md](docs/01-meta-setup.md) |
| Instagram keys | Meta App Secret | Meta app → Settings → Basic |
| Instagram keys | Instagram access token | Long‑lived Instagram User token |
| Instagram keys | Webhook verify token | A word you make up — we even prefill one. You'll reuse the **exact same** value in Meta. |
| Dynamics 365 key | Direct Line secret | Dynamics 365 Omnichannel custom channel — see [docs/02-d365-setup.md](docs/02-d365-setup.md) |

> The **Advanced (optional)** tab can be skipped — just click **Next**.

### 3. Click **Review + create**

Azure builds everything (about 2–3 minutes).

### 4. Open the Setup Assistant

When the deployment finishes, open **Outputs** and click **`setupUrl`**. This opens a friendly **Setup Assistant** page that does the fiddly parts for you:

* ✅ shows a green/red check for every value you entered;
* 🔌 **tests your Instagram and Dynamics 365 connections** live (no guessing whether a key is right);
* 📋 gives you the **webhook URL** to copy into Meta, then **subscribes your account to messages in one click**;
* ♻️ turns a short‑lived Instagram token into a **long‑lived** one (no command line) when you need to refresh.

To run the tests you unlock the page with your **Meta App Secret** (so only you can use it).

### 5. Copy the webhook URL into Meta

In the Setup Assistant (or from the `webhookUrl` output), copy the callback URL and paste it into the Meta webhook configuration with your verify token. Click **Verify and save**, then hit **Subscribe** in the assistant. Done.

That's the entire customer experience: **click → follow the wizard → open the Setup Assistant → you're live.**

---

## Setup guides

Follow these in order. The first two gather your five values; the third is the short version to hand to a customer.

| # | Guide | What you get | Time |
| --- | --- | --- | --- |
| 1 | **[Meta / Instagram setup](docs/01-meta-setup.md)** | App Secret, IG_ID, access token, verify token | ~20 min |
| 2 | **[Dynamics 365 setup](docs/02-d365-setup.md)** | Direct Line secret, a routed workstream | ~15 min |
| 3 | **[Customer quickstart](docs/03-customer-quickstart.md)** | A one-page checklist for the deployer | ~5 min |

---

## What gets created in Azure

| Resource | Purpose | Cost profile |
| --- | --- | --- |
| Container App | Runs the relay | Scales to a single small instance |
| Container Apps environment | Hosting environment | Shared |
| Log Analytics workspace | Logs / troubleshooting | Pay‑as‑you‑go, 30‑day retention |

Secrets are stored as **masked Container App secrets**, never as plain text.

---

## Maintainer setup (one time)

The "Deploy to Azure" button only works after the repo is **public** and the container image is published.

1. Push this repository to GitHub as a **public** repo named `d365-instagram-channel` under the owner referenced in the button URL.
2. The included GitHub Action ([.github/workflows/build-image.yml](.github/workflows/build-image.yml)) builds and publishes the image to **GHCR** on every push to `main`.
3. In the repo's **Packages** settings, make the published package **public** so customers can pull it without logging in.
4. Verify the raw URLs resolve:
   * `https://raw.githubusercontent.com/<owner>/d365-instagram-channel/main/infra/azuredeploy.json`
   * `https://raw.githubusercontent.com/<owner>/d365-instagram-channel/main/infra/createUiDefinition.json`

If you fork under a different owner, update the owner in the button URL above, in `containerImage` (in [infra/mainTemplate.bicep](infra/mainTemplate.bicep) and [infra/createUiDefinition.json](infra/createUiDefinition.json)), then recompile with `az bicep build --file infra/mainTemplate.bicep --outfile infra/azuredeploy.json`.

---

## Run locally (developers)

```bash
npm install
cp .env.example .env   # fill in the values
npm run build
npm start
```

Expose the local port with a tunnel (for example `dev tunnels` or `ngrok`) to receive Meta webhooks during development.

---

## Design notes & limits

* **Single replica.** The relay keeps the Instagram ↔ Direct Line conversation map in memory, so it runs as one instance (the Bicep pins `min = max = 1`). To scale out, swap [`src/store.ts`](src/store.ts) for a shared store (Cosmos DB / Table Storage / Redis) behind the same interface.
* **24‑hour window.** Instagram only allows replies within 24 hours of the customer's last message (Meta policy). Human‑agent message tags can extend this; not enabled by default.
* **Message types.** Text and simple media URLs are relayed both ways. Rich cards/templates are not mapped in this version.
* **Not an official Microsoft or Meta product.** Provided under the MIT license, as‑is.

---

## License

MIT — see [LICENSE](LICENSE).
