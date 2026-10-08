export const SERVICE_IDS = [
  'sonarr',
  'radarr',
  'prowlarr',
  'bazarr',
  'decypharr',
  'flaresolverr',
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

export interface ServiceDescriptor {
  id: ServiceId;
  port: number;
  internalUrl: string;
  hostUrl: string;
}

const SERVICE_PORTS: Record<ServiceId, number> = {
  sonarr: 8989,
  radarr: 7878,
  prowlarr: 9696,
  bazarr: 6767,
  decypharr: 8282,
  flaresolverr: 8191,
};

function describeService(id: ServiceId): ServiceDescriptor {
  const port = SERVICE_PORTS[id];
  return {
    id,
    port,
    internalUrl: `http://${id}:${port}`,
    hostUrl: `http://127.0.0.1:${port}`,
  };
}

export const SERVICE_CATALOG: Readonly<Record<ServiceId, ServiceDescriptor>> = Object.freeze(
  Object.fromEntries(SERVICE_IDS.map((id) => [id, describeService(id)])) as Record<
    ServiceId,
    ServiceDescriptor
  >,
);
