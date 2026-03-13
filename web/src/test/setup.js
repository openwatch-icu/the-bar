import '@testing-library/jest-dom'

// jsdom does not provide ResizeObserver or IntersectionObserver
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (typeof IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
    get root() {
      return null
    }
    get rootMargin() {
      return ''
    }
    get thresholds() {
      return []
    }
  }
}
