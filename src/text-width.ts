/**
 * How wide a string is on a screen, and a string cut to a width - the one thing the core takes from pi-tui. It draws
 * nothing: the `turri-skill` widget lays its progress line out by it, and a host (turri-app) reads that line back by its
 * spacing, so the core measures exactly as pi's screen does. No other core file imports pi-tui
 * (tests/boundary.test.ts).
 */
export { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
