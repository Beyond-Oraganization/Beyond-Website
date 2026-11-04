import { create } from 'zustand'

/** Sheets that several screens open: the phone's More menu and the install help. */
export const useUi = create<{
  moreOpen: boolean
  installOpen: boolean
  paletteOpen: boolean
  set: (patch: Partial<{ moreOpen: boolean; installOpen: boolean; paletteOpen: boolean }>) => void
}>((set) => ({
  moreOpen: false,
  installOpen: false,
  paletteOpen: false,
  set: (patch) => set(patch),
}))
