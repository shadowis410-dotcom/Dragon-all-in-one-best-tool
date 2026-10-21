import express from 'express';
import { createServer as createViteServer } from 'vite';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import net from 'net';
import { pythonBotTemplate, pythonRequirements } from './src/pythonTemplates';
import dotenv from 'dotenv';

// Load environmental variables
dotenv.config();

// Define _dirname and _filename in ESM / CJS compatibly
let localFilename = '';
let localDirname = '';

try {
  if (typeof (globalThis as any).__filename !== 'undefined') {
    localFilename = (globalThis as any).__filename;
  }
} catch (e) {}

try {
  if (!localFilename && typeof import.meta !== 'undefined' && import.meta.url) {
    localFilename = fileURLToPath(import.meta.url);
  }
} catch (e) {}

try {
  if (typeof (globalThis as any).__dirname !== 'undefined') {
    localDirname = (globalThis as any).__dirname;
  }
} catch (e) {}

if (localFilename && !localDirname) {
  localDirname = path.dirname(localFilename);
} else if (!localDirname) {
  localDirname = process.cwd();
}

const _filename = localFilename;
const _dirname = localDirname;

const app = express();
app.use(express.json());

const PORT = 3000;

let botProcess: ChildProcess | null = null;
const logsBuffer: string[] = [];
const MAX_LOGS = 300;

function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  logsBuffer.push(`[${timestamp}] ${message}`);
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }
  console.log(`[BOT CONTROLLER] ${message}`);
}

let lastMatchedLine = 'None';

function getRunningBotPid(): number | null {
  lastMatchedLine = 'None';
  try {
    const stdout = execSync('ps -ef').toString();
    const lines = stdout.split('\n');
    let matched = false;
    for (const line of lines) {
      if (line.includes('bot.py') && 
          (line.includes('python3') || line.includes('python')) && 
          !line.includes('ps') && 
          !line.includes('grep') && 
          !line.includes('sh -c') &&
          !line.includes('cmd') &&
          !line.includes('server.ts')) {
        lastMatchedLine = line;
        matched = true;
        const parts = line.trim().split(/\s+/);
        if (parts.length > 1) {
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            return pid;
          }
        }
      }
    }
    if (!matched) {
      lastMatchedLine = 'None';
    }
  } catch (e) {}
  return null;
}

function installPythonDependencies() {
  addLog('Checking and installing Python dependencies from requirements.txt...');
  const reqPath = path.join(process.cwd(), 'requirements.txt');
  if (!fs.existsSync(reqPath)) {
    fs.writeFileSync(reqPath, pythonRequirements);
  }

  // Optimize: Check if python dependencies are already successfully installed and importable.
  // If they are importable, we can safely bypass the pip command execution entirely.
  try {
    const checkScript = 'import aiohttp; import discord; import websockets; import colorama; import dotenv';
    execSync(`python3 -c "${checkScript}"`, { stdio: 'ignore' });
    addLog('Python dependencies are already verified, healthy, and importable. Skipping pip installation.');
    return;
  } catch (err) {
    addLog('Some python dependencies are missing or unimportable. Proceeding with pip installation...');
  }

  // Check if pip is available. If not, download and install pip via bootstrap script
  try {
    execSync('python3 -m pip --version', { stdio: 'ignore' });
  } catch (err) {
    try {
      execSync('pip3 --version', { stdio: 'ignore' });
    } catch (err2) {
      addLog('pip is not found on the system. Attempting to download and bootstrap pip automatically...');
      try {
        execSync('curl -sS https://bootstrap.pypa.io/get-pip.py -o get-pip.py');
        execSync('python3 get-pip.py --break-system-packages || python3 get-pip.py');
        execSync('rm -f get-pip.py');
        addLog('Successfully bootstrapped pip!');
      } catch (bootstrapErr: any) {
        addLog(`Failed to bootstrap pip: ${bootstrapErr.message}`);
      }
    }
  }

  let installed = false;
  const commands = [
    'pip3 install -r requirements.txt --break-system-packages',
    'python3 -m pip install -r requirements.txt --break-system-packages',
    'pip install -r requirements.txt --break-system-packages',
    'pip3 install -r requirements.txt',
    'python3 -m pip install -r requirements.txt',
    'pip install -r requirements.txt'
  ];
  for (const cmd of commands) {
    try {
      addLog(`Executing: ${cmd}`);
      const output = execSync(cmd, { encoding: 'utf8' });
      addLog(`Dependencies installation output:\n${output}`);
      // Re-verify after install
      try {
        const checkScript = 'import aiohttp; import discord; import websockets; import colorama; import dotenv';
        execSync(`python3 -c "${checkScript}"`, { stdio: 'ignore' });
        addLog('Python dependencies successfully installed and verified!');
        installed = true;
        break;
      } catch (checkErr) {
        addLog(`Pip command succeeded but verification failed, trying next command...`);
      }
    } catch (e: any) {
      addLog(`Command '${cmd}' failed or not available: ${e.message}`);
    }
  }
  if (!installed) {
    addLog('WARNING: All default pip/pip3 commands failed or verification failed. If dependencies are missing, please verify pip is installed.');
  }
}

const serverBootTime = Date.now();
let botStartTime: number | null = null;
let totalBotRestarts = 0;
let lastBotRestartAt: string | null = null;
let selfPingsCount = 0;
let lastSelfPingAt: string | null = null;
let isIntentionallyStopped = false;

function initKeepAliveLoop() {
  addLog('[24/7 GUARDIAN] Keep-alive heartbeat engine initiated (3.5-minute cycle).');
  setInterval(async () => {
    try {
      selfPingsCount++;
      lastSelfPingAt = new Date().toLocaleTimeString();
      try {
        await fetch(`http://localhost:${PORT}/health`);
      } catch (e) {}
      if (process.env.APP_URL) {
        try {
          await fetch(`${process.env.APP_URL.replace(/\/$/, '')}/health`);
        } catch (e) {}
      }
      addLog(`[24/7 GUARDIAN] Keep-alive ping #${selfPingsCount} recorded at ${lastSelfPingAt}. System awake & listening.`);
    } catch (err: any) {
      // ignore
    }
  }, 210000);
}

function startBotProcess(configData: any) {
  // Terminate any existing bot.py processes on the system to avoid conflicts
  if (botProcess && botProcess.exitCode === null) {
    try {
      botProcess.kill('SIGKILL');
    } catch (e) {}
    botProcess = null;
  }
  try {
    execSync('pkill -9 -f "bot.py" 2>/dev/null || killall -9 python3 2>/dev/null || true');
    addLog('Terminated stale system bot processes.');
  } catch (e) {}

  addLog('Launching Python bot (python3 bot.py)...');
  isIntentionallyStopped = false;
  botStartTime = Date.now();
  let hasLoginFailure = false;

  // Spawn Python3 process
  botProcess = spawn('python3', ['bot.py'], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  botProcess.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      const cleanOutput = output.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      addLog(`[STDOUT] ${cleanOutput}`);
      if (cleanOutput.includes('Improper token') || cleanOutput.includes('LoginFailure') || cleanOutput.includes('Improper token has been passed')) {
        hasLoginFailure = true;
      }
    }
  });

  botProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      const cleanOutput = output.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      addLog(`[STDERR] ${cleanOutput}`);
      if (cleanOutput.includes('Improper token') || cleanOutput.includes('LoginFailure') || cleanOutput.includes('Improper token has been passed')) {
        hasLoginFailure = true;
      }
    }
  });

  botProcess.on('error', (err) => {
    addLog(`[ERROR] Failed to start Python process: ${err.message}`);
    botProcess = null;
  });

  botProcess.on('close', (code) => {
    addLog(`[CLOSE] Python process terminated with exit code ${code}`);
    botProcess = null;

    // Auto-restart 24/7 if not intentionally stopped
    if (!isIntentionallyStopped) {
      setTimeout(() => {
        if (!isIntentionallyStopped) {
          if (hasLoginFailure) {
            addLog('Auto-restart skipped: Critical login failure detected (Improper Token). Please correct your Discord Token in settings before running again.');
            return;
          }
          try {
            const configPath = path.join(process.cwd(), 'config.json');
            if (fs.existsSync(configPath)) {
              const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              if (loadedConfig && loadedConfig.master_bot_token && 
                  !loadedConfig.master_bot_token.includes('SampleMaster') && 
                  !loadedConfig.master_bot_token.includes('YOUR_MASTER_BOT_TOKEN')) {
                totalBotRestarts++;
                lastBotRestartAt = new Date().toLocaleTimeString();
                addLog(`[24/7 GUARDIAN] Auto-restart #${totalBotRestarts} triggered in 5 seconds to maintain 24/7 uptime...`);
                startBotProcess(loadedConfig);
              } else {
                addLog('Auto-restart skipped: Master bot token is empty or is a sample/placeholder.');
              }
            }
          } catch (err: any) {
            addLog(`Auto-restart error: ${err.message}`);
          }
        }
      }, 5000);
    }
  });
}

function autoStartBotIfConfigured() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (loadedConfig && loadedConfig.master_bot_token && 
          !loadedConfig.master_bot_token.includes('SampleMaster') && 
          !loadedConfig.master_bot_token.includes('YOUR_MASTER_BOT_TOKEN')) {
        addLog('Auto-starting bot from existing config.json on server boot...');
        startBotProcess(loadedConfig);
      } else {
        addLog('Auto-start skipped: No valid master_bot_token found in config.json.');
      }
    } else {
      addLog('Auto-start skipped: config.json does not exist yet.');
    }
  } catch (err: any) {
    addLog(`Error during startup auto-start check: ${err.message}`);
  }
}

function syncEnvironmentToConfig() {
  addLog('Syncing environment variables with config.json...');
  const configPath = path.join(process.cwd(), 'config.json');
  let config: any = {
    nope_captcha_key: 'q4gd0knx5mzt60oe',
    master_bot_token: 'MTU2MjAwOTM5NjYzMTA0NDExNw.Gj2_dF.BjVKKFeGT_tTVvBSELkNZkg3vIfXwANpYXfsvw',
    prefix: '!',
    owner_ids: [
      '1546693679660539977',
      '1458799796297924719',
      '1505065613192728636',
      '1222232115027116173',
      '1522255932405579818'
    ],
    accounts: []
  };

  if (fs.existsSync(configPath)) {
    try {
      const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (existingConfig && typeof existingConfig === 'object') {
        config = { ...config, ...existingConfig };
      }
    } catch (e) {
      addLog(`Error reading existing config.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Override with environment variables / secrets if present
  const secretBotToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.MASTER_BOT_TOKEN;
  if (secretBotToken) {
    config.master_bot_token = secretBotToken.trim();
    addLog(`Master bot token loaded securely from environment secret.`);
  }
  if (process.env.NOPE_CAPTCHA_KEY) {
    config.nope_captcha_key = process.env.NOPE_CAPTCHA_KEY;
    addLog('Nope captcha key loaded from environment variable.');
  }
  if (process.env.PREFIX) {
    config.prefix = process.env.PREFIX;
    addLog('Prefix loaded from environment variable.');
  }
  if (process.env.OWNER_IDS) {
    try {
      const idsStr = process.env.OWNER_IDS.trim();
      if (idsStr.startsWith('[')) {
        config.owner_ids = JSON.parse(idsStr);
      } else {
        config.owner_ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);
      }
      addLog(`Owner IDs loaded from environment variable: ${JSON.stringify(config.owner_ids)}`);
    } catch (e) {
      addLog(`Error parsing OWNER_IDS env var: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (process.env.ACCOUNTS_JSON) {
    try {
      config.accounts = JSON.parse(process.env.ACCOUNTS_JSON);
      addLog(`Accounts registry loaded from environment variable (${config.accounts.length} accounts).`);
    } catch (e) {
      addLog(`Error parsing ACCOUNTS_JSON env var: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (process.env.GUILD_ID) {
    config.guild_id = process.env.GUILD_ID;
    addLog(`Guild ID loaded from environment variable: ${config.guild_id}`);
  }
  if (!config.guild_id) {
    config.guild_id = '1562129145788375090';
  }

  // Prune any legacy revoked/sample master tokens to keep the user's active token
  const legacyMasterTokens = [
    'MTUyODk0NDA5MDQ1OTE0NDIxMg.GxmSu5.4in_Id25UYbtbVbeAqye54d8nFScNZQ6S8y6-g',
    'MTUyMjI1NTkzMjQwNTU3OTgxOA.GfbFdU.sBLGDXqnkZ-ORgeAsnHDkhhgS7Xp0a2VFN6z4s',
    'MTI5ODU0OTk4MjE5Mzg3NDU2MQ.Gx3Y_9.SampleMasterBotToken_1029384756'
  ];
  if (!config.master_bot_token || legacyMasterTokens.includes(config.master_bot_token)) {
    config.master_bot_token = 'MTU2MjAwOTM5NjYzMTA0NDExNw.Gj2_dF.BjVKKFeGT_tTVvBSELkNZkg3vIfXwANpYXfsvw';
  }

  // Filter out any known invalid accounts that cause gateway 4004 close code
  const invalidTokens = [
    'MTUzMDc3ODU3MzQ5MTkyOTI2MQ.GCL9sG.BjDcTObC5iLR1UxbqOhua4KFGBETNBVyu-tHJw'
  ];
  config.accounts = (config.accounts || []).filter(
    (a: any) => a && a.token && !invalidTokens.includes(a.token) && a.token !== config.master_bot_token
  );

  // Ensure default owner IDs are always registered
  const defaultOwnerIds = [
    '1546693679660539977',
    '1458799796297924719',
    '1505065613192728636',
    '1222232115027116173',
    '1522255932405579818'
  ];
  for (const oid of defaultOwnerIds) {
    if (!config.owner_ids.includes(oid)) {
      config.owner_ids.push(oid);
    }
  }

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    addLog('Successfully updated and saved config.json.');
  } catch (e) {
    addLog(`Error saving config.json during sync: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Write file templates if they don't exist
function ensureBotFiles() {
  try {
    const requirementsPath = path.join(process.cwd(), 'requirements.txt');
    const botPath = path.join(process.cwd(), 'bot.py');

    if (!fs.existsSync(requirementsPath)) {
      fs.writeFileSync(requirementsPath, pythonRequirements);
      addLog('Generated requirements.txt template');
    }
    // Always overwrite bot.py to make sure the latest fixes and enhancements are deployed
    fs.writeFileSync(botPath, pythonBotTemplate);
    addLog('Updated bot.py with latest orchestration template');
    
    // Automatically install python dependencies at startup
    installPythonDependencies();
  } catch (err) {
    addLog(`Note during file verification: ${err instanceof Error ? err.message : String(err)}`);
  }
}
syncEnvironmentToConfig();
ensureBotFiles();
autoStartBotIfConfigured();
initKeepAliveLoop();

// API Routes
app.get('/health', (req, res) => {
  res.status(200).send('OK - 24/7 Bot Daemon Running');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor((Date.now() - serverBootTime) / 1000), timestamp: Date.now() });
});

// ==========================================
// 24/7 UPTIME GUARDIAN ENDPOINTS
// ==========================================
app.get('/api/uptime/status', (req, res) => {
  const pidOnSystem = getRunningBotPid();
  const isRunning = pidOnSystem !== null;
  const now = Date.now();
  const serverUptimeSeconds = Math.floor((now - serverBootTime) / 1000);
  const botUptimeSeconds = isRunning && botStartTime ? Math.floor((now - botStartTime) / 1000) : 0;

  res.json({
    botRunning: isRunning,
    botPid: pidOnSystem,
    serverBootTime,
    serverUptimeSeconds,
    botUptimeSeconds,
    totalRestarts: totalBotRestarts,
    lastRestartAt: lastBotRestartAt,
    selfPingsCount,
    lastSelfPingAt,
    keepAliveActive: true,
    autoRestartEnabled: true,
    devHealthUrl: 'https://ais-dev-xl6yradzy3p4lfs5k3admm-420115024230.asia-east1.run.app/health',
    sharedHealthUrl: 'https://ais-pre-xl6yradzy3p4lfs5k3admm-420115024230.asia-east1.run.app/health'
  });
});

app.post('/api/uptime/ping', async (req, res) => {
  const startTime = Date.now();
  try {
    const fetchRes = await fetch(`http://localhost:${PORT}/health`);
    const latency = Date.now() - startTime;
    selfPingsCount++;
    lastSelfPingAt = new Date().toLocaleTimeString();
    addLog(`[24/7 GUARDIAN] Manual ping test successful (${latency}ms, status: ${fetchRes.status})`);
    res.json({
      success: true,
      latency,
      status: fetchRes.status,
      timestamp: lastSelfPingAt
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// GITHUB OAUTH & ACCOUNT INTEGRATION
// ==========================================
const GITHUB_ACCOUNT_FILE = path.join(process.cwd(), 'github_account.json');

function getConnectedGitHubAccount() {
  try {
    if (fs.existsSync(GITHUB_ACCOUNT_FILE)) {
      return JSON.parse(fs.readFileSync(GITHUB_ACCOUNT_FILE, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

function saveConnectedGitHubAccount(data: any) {
  try {
    fs.writeFileSync(GITHUB_ACCOUNT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}
}

app.get('/api/auth/github/user', (req, res) => {
  const account = getConnectedGitHubAccount();
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
  res.json({
    connected: !!(account && account.id),
    account: account || null,
    isOAuthConfigured: !!(clientId && clientSecret),
    clientId: clientId ? `${clientId.slice(0, 4)}...${clientId.slice(-4)}` : null,
    devCallbackUrl: 'https://ais-dev-xl6yradzy3p4lfs5k3admm-420115024230.asia-east1.run.app/auth/github/callback',
    sharedCallbackUrl: 'https://ais-pre-xl6yradzy3p4lfs5k3admm-420115024230.asia-east1.run.app/auth/github/callback'
  });
});

app.get('/api/auth/github/url', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({
      error: 'GitHub OAuth Client ID is not configured.',
      configured: false,
      setupHelp: 'Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET or connect with a Personal Access Token.'
    });
  }

  const defaultRedirect = process.env.APP_URL 
    ? `${process.env.APP_URL.replace(/\/$/, '')}/auth/github/callback`
    : 'https://ais-dev-xl6yradzy3p4lfs5k3admm-420115024230.asia-east1.run.app/auth/github/callback';
  const redirectUri = (req.query.redirect_uri as string) || defaultRedirect;

  const state = Math.random().toString(36).substring(2, 15);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user,user:email',
    state: state
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, configured: true, redirectUri });
});

app.get(['/auth/github/callback', '/auth/github/callback/'], async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET;

  if (!code || !clientId || !clientSecret) {
    return res.send(`
      <html>
        <body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;border:1px solid #e11d48;border-radius:12px;background:#171717;max-width:400px;">
            <h2 style="color:#f43f5e;margin-bottom:8px;">Authentication Error</h2>
            <p style="color:#a3a3a3;font-size:14px;">Missing authorization code or GitHub OAuth credentials.</p>
            <button onclick="window.close()" style="background:#333;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:12px;">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange authorization code for access token.');
    }

    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'AI-Studio-Discord-Orchestrator'
      }
    });

    if (!userRes.ok) {
      throw new Error(`GitHub User API returned status ${userRes.status}`);
    }

    const githubUser = (await userRes.json()) as any;

    let email = githubUser.email || '';
    try {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'AI-Studio-Discord-Orchestrator'
        }
      });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as any[];
        if (Array.isArray(emails)) {
          const primary = emails.find((e: any) => e.primary) || emails[0];
          if (primary && primary.email) email = primary.email;
        }
      }
    } catch (e) {}

    const accountRecord = {
      connected: true,
      id: githubUser.id,
      login: githubUser.login,
      name: githubUser.name || githubUser.login,
      avatar_url: githubUser.avatar_url,
      html_url: githubUser.html_url,
      bio: githubUser.bio || '',
      public_repos: githubUser.public_repos || 0,
      followers: githubUser.followers || 0,
      following: githubUser.following || 0,
      email: email || 'N/A',
      connection_method: 'oauth',
      connected_at: new Date().toISOString()
    };

    saveConnectedGitHubAccount(accountRecord);
    addLog(`GitHub account connected via OAuth: @${githubUser.login}`);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>GitHub Connected</title></head>
        <body style="background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:32px 36px;border:1px solid #10b981;border-radius:14px;background:#171717;box-shadow:0 10px 30px rgba(0,0,0,0.6);max-width:380px;">
            <div style="font-size:42px;margin-bottom:12px;">🐙</div>
            <h2 style="color:#10b981;margin:0 0 8px 0;font-size:20px;">GitHub Connected!</h2>
            <p style="color:#e5e5e5;font-size:14px;margin:0 0 14px 0;">Signed in as <strong>@${githubUser.login}</strong></p>
            <p style="color:#737373;font-size:12px;margin:0;">Closing window and returning to dashboard...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'github' }, '*');
              setTimeout(() => {
                window.close();
              }, 700);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    addLog(`GitHub OAuth exchange error: ${err.message}`);
    res.send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:28px;border:1px solid #e11d48;border-radius:14px;background:#171717;max-width:420px;">
            <h2 style="color:#f43f5e;margin:0 0 8px 0;">Connection Failed</h2>
            <p style="color:#a3a3a3;font-size:13px;line-height:1.5;">${err.message}</p>
            <button onclick="window.close()" style="background:#262626;color:#fff;border:1px solid #404040;padding:8px 18px;border-radius:8px;cursor:pointer;margin-top:14px;font-weight:600;">Close</button>
          </div>
        </body>
      </html>
    `);
  }
});

app.post('/api/auth/github/token-login', async (req, res) => {
  const { token } = req.body;
  if (!token || !token.trim()) {
    return res.status(400).json({ error: 'GitHub Personal Access Token is required.' });
  }

  const cleanToken = token.trim();
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'User-Agent': 'AI-Studio-Discord-Orchestrator'
      }
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      return res.status(401).json({ error: `GitHub authentication failed (HTTP ${userRes.status}): ${errText}` });
    }

    const githubUser = (await userRes.json()) as any;
    const accountRecord = {
      connected: true,
      id: githubUser.id,
      login: githubUser.login,
      name: githubUser.name || githubUser.login,
      avatar_url: githubUser.avatar_url,
      html_url: githubUser.html_url,
      bio: githubUser.bio || '',
      public_repos: githubUser.public_repos || 0,
      followers: githubUser.followers || 0,
      following: githubUser.following || 0,
      email: githubUser.email || 'N/A',
      connection_method: 'token',
      connected_at: new Date().toISOString()
    };

    saveConnectedGitHubAccount(accountRecord);
    addLog(`GitHub account connected via Token: @${githubUser.login}`);
    res.json({ success: true, account: accountRecord });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/github/disconnect', (req, res) => {
  try {
    if (fs.existsSync(GITHUB_ACCOUNT_FILE)) {
      fs.unlinkSync(GITHUB_ACCOUNT_FILE);
    }
    addLog('GitHub account disconnected.');
    res.json({ success: true, message: 'GitHub account disconnected.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/github/save-config', (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Both clientId and clientSecret are required.' });
  }

  process.env.GITHUB_CLIENT_ID = clientId.trim();
  process.env.GITHUB_CLIENT_SECRET = clientSecret.trim();
  process.env.CLIENT_ID = clientId.trim();
  process.env.CLIENT_SECRET = clientSecret.trim();

  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  const setEnvVal = (text: string, key: string, val: string) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(text)) {
      return text.replace(regex, `${key}="${val}"`);
    }
    return `${text.trim()}\n${key}="${val}"\n`;
  };

  envContent = setEnvVal(envContent, 'GITHUB_CLIENT_ID', clientId.trim());
  envContent = setEnvVal(envContent, 'GITHUB_CLIENT_SECRET', clientSecret.trim());
  envContent = setEnvVal(envContent, 'CLIENT_ID', clientId.trim());
  envContent = setEnvVal(envContent, 'CLIENT_SECRET', clientSecret.trim());
  fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');

  addLog('Saved GitHub OAuth Client ID and Secret to .env');
  res.json({ success: true, message: 'GitHub OAuth credentials saved to .env' });
});

app.get('/api/bot/status', (req, res) => {
  const pidOnSystem = getRunningBotPid();
  const isRunning = pidOnSystem !== null;

  let loadedConfig = null;
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {}

  const hasSecretConfig = !!(
    process.env.DISCORD_BOT_TOKEN ||
    process.env.MASTER_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.DISCORD_TOKEN
  );
  const envPath = path.join(process.cwd(), '.env');
  const hasEnvFile = fs.existsSync(envPath);

  res.json({
    running: isRunning,
    pid: pidOnSystem,
    logs: logsBuffer,
    debug_last_matched_line: lastMatchedLine,
    config: loadedConfig,
    isSecretConfigured: hasSecretConfig,
    hasEnvFile,
    secretKeys: [
      process.env.DISCORD_BOT_TOKEN ? 'DISCORD_BOT_TOKEN' : null,
      process.env.MASTER_BOT_TOKEN ? 'MASTER_BOT_TOKEN' : null,
      process.env.BOT_TOKEN ? 'BOT_TOKEN' : null,
      process.env.GUILD_ID ? 'GUILD_ID' : null
    ].filter(Boolean)
  });
});

app.post('/api/bot/start', async (req, res) => {
  try {
    const { nopeCaptchaKey, masterBotToken, prefix, ownerIds, accounts, guildId } = req.body;

    // Save config.json
    const formattedAccounts = (accounts || []).map((acc: any) => ({
      alias: acc.alias,
      token: acc.token,
      proxy: acc.proxy || acc.proxyId || '',
      status: acc.status || 'online',
      added_via_cmd: acc.added_via_cmd || false
    }));

    // Ensure the target owner IDs are always included and active
    const finalOwnerIds = Array.isArray(ownerIds) ? [...ownerIds] : [];
    const requiredOwnerIds = [
      '1546693679660539977',
      '1458799796297924719',
      '1505065613192728636',
      '1222232115027116173',
      '1522255932405579818'
    ];
    for (const reqId of requiredOwnerIds) {
      if (!finalOwnerIds.includes(reqId)) {
        finalOwnerIds.push(reqId);
      }
    }

    const configData = {
      nope_captcha_key: nopeCaptchaKey || 'q4gd0knx5mzt60oe',
      master_bot_token: masterBotToken || '',
      prefix: prefix || '!',
      guild_id: guildId || req.body.guild_id || '1562129145788375090',
      owner_ids: finalOwnerIds,
      accounts: formattedAccounts
    };

    fs.writeFileSync(
      path.join(process.cwd(), 'config.json'),
      JSON.stringify(configData, null, 2),
      'utf-8'
    );
    addLog('Saved config.json with current orchestrator settings.');

    // Ensure bot.py has the latest template updates before starting
    const botPath = path.join(process.cwd(), 'bot.py');
    fs.writeFileSync(botPath, pythonBotTemplate);
    addLog('Refreshed bot.py with the latest orchestration updates.');

    // Install/verify dependencies are completely up-to-date
    installPythonDependencies();

    startBotProcess(configData);

    res.json({ success: true, pid: botProcess?.pid });
  } catch (err: any) {
    addLog(`Error starting bot: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/save-config', (req, res) => {
  try {
    const { nopeCaptchaKey, masterBotToken, prefix, ownerIds, accounts, guildId } = req.body;

    const formattedAccounts = (accounts || []).map((acc: any) => ({
      alias: acc.alias,
      token: acc.token,
      proxy: acc.proxy || acc.proxyId || '',
      status: acc.status || 'online',
      added_via_cmd: acc.added_via_cmd || false
    }));

    const finalOwnerIds = Array.isArray(ownerIds) ? [...ownerIds] : [];
    const requiredOwnerIds = [
      '1546693679660539977',
      '1458799796297924719',
      '1505065613192728636',
      '1222232115027116173',
      '1522255932405579818'
    ];
    for (const reqId of requiredOwnerIds) {
      if (!finalOwnerIds.includes(reqId)) {
        finalOwnerIds.push(reqId);
      }
    }

    const configData = {
      nope_captcha_key: nopeCaptchaKey || 'q4gd0knx5mzt60oe',
      master_bot_token: masterBotToken || '',
      prefix: prefix || '!',
      guild_id: guildId || req.body.guild_id || '1562129145788375090',
      owner_ids: finalOwnerIds,
      accounts: formattedAccounts
    };

    fs.writeFileSync(
      path.join(process.cwd(), 'config.json'),
      JSON.stringify(configData, null, 2),
      'utf-8'
    );
    addLog('Saved config.json with updated master bot and solving settings.');

    res.json({ success: true, message: 'Configuration saved successfully.' });
  } catch (err: any) {
    addLog(`Error saving config: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/save-secret', (req, res) => {
  try {
    const { token, guildId, nopeCaptchaKey } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Valid token string is required' });
    }
    const cleanToken = token.trim();
    
    // Set active in-process environment variables
    process.env.DISCORD_BOT_TOKEN = cleanToken;
    process.env.MASTER_BOT_TOKEN = cleanToken;
    if (guildId) process.env.GUILD_ID = guildId.trim();
    if (nopeCaptchaKey) process.env.NOPE_CAPTCHA_KEY = nopeCaptchaKey.trim();

    // Persist to .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const setEnvVal = (text: string, key: string, val: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(text)) {
        return text.replace(regex, `${key}="${val}"`);
      }
      return `${text.trim()}\n${key}="${val}"\n`;
    };

    envContent = setEnvVal(envContent, 'DISCORD_BOT_TOKEN', cleanToken);
    envContent = setEnvVal(envContent, 'MASTER_BOT_TOKEN', cleanToken);
    if (guildId) envContent = setEnvVal(envContent, 'GUILD_ID', guildId.trim());
    if (nopeCaptchaKey) envContent = setEnvVal(envContent, 'NOPE_CAPTCHA_KEY', nopeCaptchaKey.trim());

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');

    // Also update config.json
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        cfg.master_bot_token = cleanToken;
        if (guildId) cfg.guild_id = guildId.trim();
        if (nopeCaptchaKey) cfg.nope_captcha_key = nopeCaptchaKey.trim();
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
      } catch (e) {}
    }

    const masked = cleanToken.length > 10 ? `${cleanToken.slice(0, 7)}...${cleanToken.slice(-4)}` : '••••••••';
    addLog(`Discord Bot Token saved to secret (.env) [${masked}]`);

    res.json({
      success: true,
      message: 'Discord Bot Token successfully saved to secret environment (.env).',
      maskedToken: masked
    });
  } catch (err: any) {
    addLog(`Error saving secret token: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/stop', (req, res) => {
  addLog('Stopping Python bot process...');
  isIntentionallyStopped = true;
  
  if (botProcess && botProcess.exitCode === null) {
    try {
      botProcess.kill('SIGINT');
    } catch (e) {}
    
    // Hard kill fallback if SIGINT fails
    const processToKill = botProcess;
    setTimeout(() => {
      if (processToKill && processToKill.exitCode === null) {
        addLog('Forcing process shutdown (SIGKILL)...');
        try {
          processToKill.kill('SIGKILL');
        } catch (e) {}
      }
    }, 2500);
    
    botProcess = null;
  }

  // Always invoke system-level pkill to guarantee everything stops
  try {
    execSync('pkill -9 -f "bot.py" || true');
    addLog('System-level bot processes terminated.');
  } catch (err) {}

  res.json({ success: true, message: 'Bot stop command triggered.' });
});

app.get('/api/bot/logs', (req, res) => {
  res.json({ logs: logsBuffer });
});

app.post('/api/bot/check-token', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const response = await fetch('https://discord.com/api/v9/users/@me', {
      headers: {
        'Authorization': token.trim(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (response.ok) {
      const data: any = await response.json();
      return res.json({
        valid: true,
        user: {
          id: data.id,
          username: data.username,
          global_name: data.global_name || data.username,
          discriminator: data.discriminator,
          email: data.email || 'N/A',
          phone: data.phone || 'N/A',
          mfa_enabled: data.mfa_enabled,
          verified: data.verified,
          premium_type: data.premium_type // 0: None, 1: Nitro Classic, 2: Nitro, 3: Nitro Basic
        }
      });
    } else {
      const status = response.status;
      const text = await response.text();
      return res.json({
        valid: false,
        status,
        message: text || 'Invalid token'
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      valid: false,
      error: error.message || 'Failed to check token'
    });
  }
});

// Real TCP Proxy Checker Helper
function checkProxyTCP(host: string, port: number, timeout: number = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    
    socket.setTimeout(timeout);
    
    socket.connect(port, host, () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve(latency);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(null);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// Endpoint to verify an array of custom proxies
app.post('/api/proxies/verify-list', async (req, res) => {
  const { proxies } = req.body;
  if (!Array.isArray(proxies)) {
    return res.status(400).json({ error: 'proxies must be an array' });
  }

  try {
    const checked = await Promise.all(
      proxies.map(async (p: any) => {
        const portNum = parseInt(p.port, 10);
        if (isNaN(portNum) || !p.host) {
          return { ...p, status: 'dead', latency: null };
        }
        const latency = await checkProxyTCP(p.host, portNum, 3500);
        return {
          ...p,
          status: latency !== null ? 'working' : 'dead',
          latency: latency
        };
      })
    );
    res.json({ success: true, proxies: checked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to fetch and filter-import premium free proxies on the fly
app.post('/api/proxies/refresh-and-import', async (req, res) => {
  const { limit = 30, protocol = 'all' } = req.body;
  addLog(`Fetching fresh proxies from Proxyscrape Free API (protocol: ${protocol})...`);

  try {
    const protocolsToFetch = protocol === 'all' ? ['http', 'socks4', 'socks5'] : [protocol];
    const fetchedProxies: { host: string; port: string; protocol: string }[] = [];

    for (const proto of protocolsToFetch) {
      try {
        const url = `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=${proto}&timeout=1500&country=all&ssl=all&anonymity=all`;
        const response = await fetch(url);
        if (response.ok) {
          const text = await response.text();
          const lines = text.split('\n');
          for (const line of lines) {
            const cleaned = line.trim();
            if (cleaned && cleaned.includes(':')) {
              const [host, port] = cleaned.split(':');
              if (host && port) {
                // filter basic invalid inputs
                if (/^[0-9.]+$/.test(host) || host.includes('.')) {
                  fetchedProxies.push({ host, port, protocol: proto });
                }
              }
            }
          }
        }
      } catch (err: any) {
        addLog(`Error fetching ${proto} proxies: ${err.message}`);
      }
    }

    addLog(`Fetched ${fetchedProxies.length} raw proxies. Verifying speed and response...`);

    // Shuffle and pick 120 raw proxies to verify in parallel (to save time and get the absolute fastest)
    const shuffled = fetchedProxies.sort(() => 0.5 - Math.random()).slice(0, 120);

    const checked = await Promise.all(
      shuffled.map(async (p) => {
        const portNum = parseInt(p.port, 10);
        const latency = await checkProxyTCP(p.host, portNum, 2000); // Strict 2-second timeout for premium speed
        return {
          ...p,
          latency,
          status: latency !== null ? 'working' : 'dead'
        };
      })
    );

    // Keep only working ones, sort by fastest latency
    const working = checked
      .filter((p) => p.status === 'working' && p.latency !== null)
      .sort((a, b) => (a.latency || 9999) - (b.latency || 9999));

    addLog(`Successfully found ${working.length} high-speed active/verified proxies.`);

    // Return the top ones up to requested limit
    const finalProxies = working.slice(0, limit).map((p, idx) => ({
      id: `p-fresh-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
      host: p.host,
      port: p.port,
      user: '',
      pass: '',
      protocol: p.protocol as any,
      status: 'working' as const,
      latency: p.latency || undefined
    }));

    res.json({ success: true, proxies: finalProxies });
  } catch (err: any) {
    addLog(`Error refreshing proxy pool: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Start server
async function startServer() {
  // Serve API routes first
  
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Full-Stack server running on http://localhost:${PORT}`);
  });
}

startServer();
