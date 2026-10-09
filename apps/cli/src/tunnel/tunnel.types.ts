import type { ServiceId } from '@moody-blues/provisioner';

export interface TunnelService {
  id: ServiceId;
  port: number;
}

export interface TunnelForward {
  service: ServiceId;
  localPort: number;
  remotePort: number;
  url: string;
}

export interface TunnelPlan {
  target: string;
  forwards: TunnelForward[];
  sshArgs: string[];
}

export interface TunnelForwardStatus extends TunnelForward {
  reachable: boolean;
}

export interface TunnelReport {
  target: string;
  forwards: TunnelForwardStatus[];
}
