# Deploying KayKit Forest Games on CloudPanel

This guide provides step-by-step instructions for deploying and running the KayKit Forest Games collection on a **CloudPanel** server.

---

## 1. Overview

- **Architecture**: 100% client-side Three.js 3D web application.
- **Web Root**: `public/` (contains `index.html`, `style.css`, `assets/`, `vendor/`, and sub-games `/chess/`, `/arena/`, `/tactics/`, `/relic/`).
- **Recommended CloudPanel Site Type**: **Static HTML Site** (served directly by Nginx for high throughput, zero memory footprint, and low latency for 3D binary assets).

---

## 2. Step-by-Step Setup

### Step 1: Create the Site in CloudPanel

1. Log into your CloudPanel dashboard (`https://<your-server-ip>:8443`).
2. Click **+ Add Site** and choose **Create a Static HTML Site**.
3. Fill in:
   - **Site Name / Domain**: e.g. `game.yourdomain.com`
   - **Site User**: Select or create a dedicated user (e.g. `games-user`)
   - **Site User Password**: Set a secure password
4. Click **Create**.
5. Once created, go to the **SSL/TLS** tab, choose **New Let's Encrypt Certificate**, and click **Create and Install**.

---

### Step 2: Configure the Nginx Vhost (Critical for 3D Games)

Because Three.js games load `.glb`, `.gltf`, `.bin`, `.woff2`, and ES modules, CloudPanel's default Nginx configuration must be customized.

1. In CloudPanel, click on your site and select the **Vhost** tab.
2. Replace or update the Vhost configuration with the following (also available in [`cloudpanel-nginx.conf`](./cloudpanel-nginx.conf)):

```nginx
server {
  listen 80;
  listen [::]:80;
  listen 443 quic;
  listen 443 ssl;
  listen [::]:443 quic;
  listen [::]:443 ssl;
  http2 on;
  http3 off;
  {{ssl_certificate_key}}
  {{ssl_certificate}}
  server_name wildwood.malinjayaweera.com;
  {{root}}

  {{nginx_access_log}}
  {{nginx_error_log}}

  if ($scheme != "https") {
    rewrite ^ https://$host$request_uri permanent;
  }

  location ~ /.well-known {
    auth_basic off;
    allow all;
  }

  {{settings}}

  include /etc/nginx/global_settings;

  index index.html;

  location ~* ^.+\.(css|js|jpg|jpeg|gif|png|ico|gz|svg|svgz|ttf|otf|woff|woff2|eot|mp4|ogg|ogv|webm|webp|zip|swf)$ {
    add_header Access-Control-Allow-Origin "*";
    add_header alt-svc 'h3=":443"; ma=86400';
    expires max;
    access_log off;
  }

  if (-f $request_filename) {
    break;
  }
}
```

3. Click **Save** to apply the configuration.

---

## 3. Deployment Options

Choose the deployment method that fits your workflow:

### Option A: Automated CI/CD via GitHub Actions (Recommended)

A workflow is included at [`.github/workflows/deploy-cloudpanel.yml`](./.github/workflows/deploy-cloudpanel.yml).

1. In your GitHub repository, navigate to **Settings → Secrets and variables → Actions**.
2. Add the following repository secrets:
   - `CLOUDPANEL_HOST`: Your server IP address or hostname.
   - `CLOUDPANEL_USER`: Your CloudPanel site user (e.g. `games-user`).
   - `CLOUDPANEL_SSH_KEY`: The private SSH key for that user.
   - `CLOUDPANEL_DOMAIN`: Your domain name (e.g. `game.yourdomain.com`).
3. Whenever you push to `main`, GitHub Actions will run tests and rsync `public/` into `/home/<user>/htdocs/<domain>/`.

---

### Option B: Server-Side Git Deployment via SSH

If you have SSH access to your server:

1. SSH into the server as the site user:
   ```bash
   ssh <site-user>@<server-ip>
   ```
2. Clone the repository into your user directory:
   ```bash
   cd /home/<site-user>/
   git clone <your-git-repo-url> repo
   ```
3. Run the included deployment script:
   ```bash
   chmod +x repo/scripts/deploy-cloudpanel.sh
   ./repo/scripts/deploy-cloudpanel.sh <domain-name>
   ```
   *(For subsequent updates, simply rerun `./repo/scripts/deploy-cloudpanel.sh <domain-name>`.)*

---

### Option C: Manual Upload via CloudPanel File Manager

1. Create a zip archive of the `public/` folder contents:
   ```powershell
   # Windows PowerShell:
   Compress-Archive -Path public\* -DestinationPath game-deploy.zip
   ```
2. In CloudPanel:
   - Go to your site → **File Manager**.
   - Navigate to `/htdocs/<domain>/`.
   - Click **Upload** and upload `game-deploy.zip`.
   - Right-click the uploaded zip file and select **Extract**.
   - Delete `game-deploy.zip`.

---

## 4. Online Features (Supabase Integration)

The games can run completely offline with built-in AI bots. If you want online features (PvP raids in Arena, Realtime duels in Tactics):

1. **Configure Supabase URL and Key**:
   - Edit [`public/arena/config.js`](./public/arena/config.js) with your project URL and publishable key:
     ```javascript
     export const CONFIG = {
       supabaseUrl: 'https://<your-project>.supabase.co',
       supabasePublishableKey: 'sb_publishable_...',
     };
     ```
2. **Supabase Dashboard Settings**:
   - **Authentication → Sign In / Providers**: Turn on **Allow anonymous sign-ins**.
   - **Authentication → URL Configuration**: Add your CloudPanel domain (e.g. `https://game.yourdomain.com`) to **Redirect URLs** and **CORS Allowed Origins**.
3. **Database & Edge Function**:
   - Run `supabase db push` (or execute `supabase/migrations/20261002000000_arena.sql` in the Supabase SQL Editor).
   - Run `supabase functions deploy arena --no-verify-jwt`.

---

## 5. Verification Checklist

After deployment, verify the following:

- [ ] **SSL / HTTPS**: Site loads securely over HTTPS with a valid certificate.
- [ ] **Game Hub**: Start screen loads at `https://<domain>/` with tile thumbnails and navigation.
- [ ] **3D Assets**: In DevTools Network tab, `.glb` packs return `200 OK` with `content-type: model/gltf-binary`.
- [ ] **Sub-games**:
  - `/chess/` (Wizard's Chess)
  - `/arena/` (Wildwood Arena)
  - `/tactics/` (Wildwood Tactics)
  - `/relic/` (Forest Relic Hunt: Wildwood Colony)
