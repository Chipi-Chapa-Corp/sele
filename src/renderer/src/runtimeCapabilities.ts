export const isRemoteClient = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { seleRemoteClient?: boolean }).seleRemoteClient)

export const isAndroidClient = (): boolean => import.meta.env?.VITE_SELE_ANDROID === 'true'
