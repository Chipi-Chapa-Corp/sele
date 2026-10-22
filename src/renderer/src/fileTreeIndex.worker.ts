import { buildFileTreeIndex } from './fileTreeIndex'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, index: buildFileTreeIndex(data.listing) })
  } catch (error) {
    console.error('[caught:fileTreeIndex.worker]', error)
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
}
