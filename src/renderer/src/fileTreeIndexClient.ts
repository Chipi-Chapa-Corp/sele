import FileTreeIndexWorker from './fileTreeIndex.worker?worker'
import type { AppFileTreeListing } from '../../shared/app'
import { buildFileTreeIndex, type FileTreeIndex } from './fileTreeIndex'

// Small folders index in well under a millisecond; a worker round trip would only add latency.
const workerFileCountThreshold = 2_000
const workerIdleMs = 30_000

type Job = { resolve: (index: FileTreeIndex) => void; reject: (error: Error) => void }
const jobs = new Map<number, Job>()
let worker: Worker | null = null
let sequence = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

const releaseWhenIdle = (): void => {
  if (jobs.size) return
  idleTimer = setTimeout(() => {
    worker?.terminate()
    worker = null
    idleTimer = null
  }, workerIdleMs)
}

const fail = (error: Error): void => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  worker?.terminate()
  worker = null
  for (const job of jobs.values()) job.reject(error)
  jobs.clear()
}

const getWorker = (): Worker => {
  if (worker) return worker
  const nextWorker = new FileTreeIndexWorker()
  nextWorker.onmessage = ({ data }) => {
    const job = jobs.get(data.id)
    jobs.delete(data.id)
    if (data.error) job?.reject(new Error(data.error))
    else job?.resolve(data.index)
    releaseWhenIdle()
  }
  nextWorker.onerror = (event) => fail(new Error(event.message || 'File tree worker failed'))
  nextWorker.onmessageerror = () => fail(new Error('Unable to receive the file tree index'))
  worker = nextWorker
  return nextWorker
}

const indexInWorker = (listing: AppFileTreeListing): Promise<FileTreeIndex> =>
  new Promise((resolve, reject) => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const id = ++sequence
    jobs.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, listing })
    } catch (error) {
      console.error('[caught:fileTreeIndexClient:indexInWorker]', error)
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** Builds the sidebar's folder index away from the renderer's main thread. */
export const indexFileTreeListing = async (listing: AppFileTreeListing): Promise<FileTreeIndex> => {
  if (listing.fileCount < workerFileCountThreshold) return buildFileTreeIndex(listing)

  try {
    return await indexInWorker(listing)
  } catch (error) {
    // Still show the files; this only costs main-thread time on this one listing.
    console.error('[caught:fileTreeIndexClient:indexFileTreeListing]', error)
    return buildFileTreeIndex(listing)
  }
}
