export type DiscordStatus = 'online' | 'idle' | 'dnd' | 'offline' | 'off';

export interface DiscordAccount {
  id: string;
  token: string;
  alias: string;
  status: DiscordStatus;
  proxyId: string; // empty string means none
  activeVC: string; // active Voice Channel Link / ID if joined, empty if none
  added_via_cmd?: boolean;
}

export interface ProxyItem {
  id: string;
  host: string;
  port: string;
  user?: string;
  pass?: string;
  protocol: 'http' | 'socks4' | 'socks5';
  status: 'unchecked' | 'working' | 'dead';
  latency?: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'system' | 'proxy';
  message: string;
}

export interface AppConfig {
  nopeCaptchaKey: string;
  masterBotToken: string;
  prefix: string;
  ownerIds: string[];
  guildId?: string;
}
