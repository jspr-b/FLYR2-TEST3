/**
 * Schiphol API integration utilities
 */

// Schiphol API credentials - prefer environment variables, fallback to provided values
const SCHIPHOL_APP_KEY = process.env.SCHIPHOL_APP_KEY || 'bf01b2f53e73e9db0115b8f2093c97b9'
const SCHIPHOL_APP_ID = process.env.SCHIPHOL_APP_ID || 'cfcad115'

// Schiphol API base URL
const SCHIPHOL_API_BASE = 'https://api.schiphol.nl/public-flights'

// Production timeout settings - reduced for faster response
const API_TIMEOUT = 15000 // 15 seconds (reduced from 30)
const MAX_RETRIES = 2 // Reduced from 3
const RETRY_DELAY = 500 // Reduced from 1000ms

// Cache for API responses (10 minutes)
const CACHE_DURATION = 10 * 60 * 1000 // 10 minutes in milliseconds
const apiCache = new Map<string, { data: any; timestamp: number }>()

// Concurrent page fetching for better performance
const CONCURRENT_PAGES = 3 // Fetch 3 pages at once
const PAGE_DELAY = 50 // Reduced delay between pages

export interface SchipholApiConfig {
  flightDirection?: 'D' | 'A'
  airline?: string
  scheduleDate?: string
  fetchAllPages?: boolean
}

export interface SchipholFlight {
  flightName: string
  flightNumber: number
  flightDirection: 'D' | 'A'
  scheduleDateTime: string
  scheduleDate?: string
  publicEstimatedOffBlockTime: string
  publicFlightState: {
    flightStates: string[]
  }
  aircraftType: {
    iataMain: string
    iataSub: string
  }
  gate: string
  pier: string
  route: {
    destinations: string[]
  }
  lastUpdatedAt: string
  // Operating carrier information
  mainFlight?: string
  prefixIATA?: string
  prefixICAO?: string
}

export interface SchipholApiResponse {
  flights: SchipholFlight[]
  meta?: {
    totalCount?: number
    page?: number
    limit?: number
  }
}

/**
 * Generate cache key for API requests
 */
function generateCacheKey(config: SchipholApiConfig): string {
  // Use a shared cache key for all dashboard data to avoid redundant API calls
  // All dashboard endpoints fetch the same base flight data, just process it differently
  if (config.fetchAllPages) {
    const dateSuffix = config.scheduleDate ? `-${config.scheduleDate}` : ''
    return `dashboard-shared-all-pages${dateSuffix}`
  }
  return 'dashboard-shared-single-page'
}

/**
 * Check if cached data is still valid
 */
function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_DURATION
}

/**
 * Fetch flights from Schiphol API with 10-minute caching
 */
export async function fetchSchipholFlights(config: SchipholApiConfig): Promise<SchipholApiResponse> {
  const cacheKey = generateCacheKey(config)
  
  // Check cache first
  const cached = apiCache.get(cacheKey)
  if (cached && isCacheValid(cached.timestamp)) {
    console.log('Using cached Schiphol API data for:', cacheKey)
    return cached.data
  }

  // If fetchAllPages is true, fetch all pages
  if (config.fetchAllPages) {
    return await fetchAllPages(config)
  }

  // Single page fetch
  const params = new URLSearchParams()
  
  // Only use supported parameters
  if (config.flightDirection) {
    params.append('flightDirection', config.flightDirection)
  }
  
  if (config.airline) {
    params.append('airline', config.airline)
  }

  if (config.scheduleDate) {
    params.append('scheduleDate', config.scheduleDate)
  }

  const apiUrl = `${SCHIPHOL_API_BASE}/flights?${params.toString()}`
  
  console.log('Calling Schiphol API (not cached):', apiUrl)
  
  // Create AbortController for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
  
  let response
  try {
    response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'app_id': SCHIPHOL_APP_ID,
        'app_key': SCHIPHOL_APP_KEY,
        'ResourceVersion': 'v4'
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Schiphol API error:', response.status, response.statusText, errorText)
    
    // Handle specific error cases
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.')
    }
    
    if (response.status === 401) {
      throw new Error('Invalid API credentials. Check SCHIPHOL_APP_KEY and SCHIPHOL_APP_ID environment variables.')
    }
    
    if (response.status === 403) {
      throw new Error('Access forbidden. Check API permissions.')
    }
    
    if (response.status === 408 || response.status === 504) {
      throw new Error('Request timeout. The API is taking too long to respond.')
    }
    
    throw new Error(`Schiphol API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  console.log('Schiphol API response received:', {
    flightCount: data.flights?.length || 0,
    meta: data.meta
  })

  // Cache the response
  apiCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  })

  // Clean up old cache entries (older than 15 minutes)
  const cleanupTime = Date.now() - (15 * 60 * 1000)
  for (const [key, value] of apiCache.entries()) {
    if (value.timestamp < cleanupTime) {
      apiCache.delete(key)
    }
  }

  return data
}

/**
 * Fetch all pages of flights from Schiphol API with retry logic
 */
async function fetchAllPages(config: SchipholApiConfig): Promise<SchipholApiResponse> {
  const allFlights: any[] = []
  let page = 0
  const maxPages = 50 // Safety limit to prevent infinite loops
  
  console.log('Fetching all pages of Schiphol API data...')
  
  while (page < maxPages) {
    const params = new URLSearchParams()
    
    if (config.flightDirection) {
      params.append('flightDirection', config.flightDirection)
    }
    
    if (config.airline) {
      params.append('airline', config.airline)
    }
    
    if (config.scheduleDate) {
      params.append('scheduleDate', config.scheduleDate)
    }
    
    params.append('page', page.toString())

    const apiUrl = `${SCHIPHOL_API_BASE}/flights?${params.toString()}`
    
    console.log(`Fetching page ${page}:`, apiUrl)
    
    // Retry logic for each page
    let response
    let retries = 0
    
    while (retries < MAX_RETRIES) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
        
        try {
          response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'app_id': SCHIPHOL_APP_ID,
              'app_key': SCHIPHOL_APP_KEY,
              'ResourceVersion': 'v4'
            },
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeoutId)
        }
        
        break // Success, exit retry loop
      } catch (error) {
        retries++
        console.warn(`Page ${page} attempt ${retries} failed:`, error)
        
        if (retries >= MAX_RETRIES) {
          console.error(`Failed to fetch page ${page} after ${MAX_RETRIES} attempts`)
          throw error
        }
        
        // Faster retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, retries - 1)))
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Schiphol API error on page ${page}:`, response.status, response.statusText, errorText)
      break
    }

    let data: any = {}
    try {
      data = await response.json()
    } catch (err) {
      console.error(`Failed to parse JSON on page ${page}:`, err)
      break
    }
    
    const flights = data.flights || []
    
    console.log(`Page ${page}: ${flights.length} flights`)
    
    // If no flights returned, we've reached the end
    if (flights.length === 0) {
      break
    }
    
    allFlights.push(...flights)
    page++
    
    // Reduced delay for faster performance
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, PAGE_DELAY))
    }
  }
  
  console.log(`Total flights fetched: ${allFlights.length} from ${page} pages`)
  
  const result = {
    flights: allFlights,
    meta: {
      totalCount: allFlights.length,
      pages: page
    }
  }
  
  // Cache the complete result
  const cacheKey = generateCacheKey(config)
  apiCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  })
  
  return result
}

/**
 * Transform Schiphol API flight data to our internal format
 */
export function transformSchipholFlight(flight: any): SchipholFlight {
  return {
    flightName: flight.flightName || '',
    flightNumber: flight.flightNumber || 0,
    flightDirection: flight.flightDirection || 'D',
    scheduleDateTime: flight.scheduleDateTime || flight.scheduleDate || '',
    scheduleDate: flight.scheduleDate || flight.scheduleDateTime?.split('T')[0] || '',
    publicEstimatedOffBlockTime: flight.publicEstimatedOffBlockTime || flight.estimatedOffBlockTime || flight.scheduleDateTime || '',
    publicFlightState: {
      flightStates: flight.publicFlightState?.flightStates || flight.flightStates || []
    },
    aircraftType: {
      iataMain: flight.aircraftType?.iataMain || (typeof flight.aircraftType === 'string' ? flight.aircraftType : '') || '',
      iataSub: flight.aircraftType?.iataSub || (typeof flight.aircraftType === 'string' ? flight.aircraftType : '') || ''
    },
    gate: flight.gate || '',
    pier: flight.pier || '',
    route: {
      destinations: flight.route?.destinations || flight.destinations || []
    },
    lastUpdatedAt: flight.lastUpdatedAt || flight.updatedAt || new Date().toISOString(),
    // Operating carrier information
    mainFlight: flight.mainFlight || undefined,
    prefixIATA: flight.prefixIATA || undefined,
    prefixICAO: flight.prefixICAO || undefined
  }
}

/**
 * Check if a flight is operational based on its state
 */
export function isOperationalFlight(flight: SchipholFlight): boolean {
  const operationalStates = ['SCHEDULED', 'BOARDING', 'ON_TIME', 'DELAYED', 'DEPARTED']
  return flight.publicFlightState?.flightStates?.some(state => 
    operationalStates.includes(state)
  ) || true // Default to true if no state info
}

/**
 * Filter flights by various criteria
 */
export function filterFlights(
  flights: SchipholFlight[], 
  filters: {
    flightDirection?: 'D' | 'A'
    scheduleDate?: string
    prefixicao?: string
    isOperationalFlight?: boolean
  }
): SchipholFlight[] {
  let filtered = flights
  const initialCount = flights.length

  // Note: flightDirection and airline are already filtered by the API
  // We only need to filter by date and operational status on the client side

  // Filter for KLM-operated flights only (not codeshares)
  if (filters.prefixicao === 'KL') {
    const beforeKLMFilter = filtered.length
    filtered = filtered.filter(flight => {
      // Check if this is a true KLM-operated flight (not a codeshare)
      const mainFlight = flight.mainFlight || flight.flightName || ''
      
      // Only include flights where the mainFlight (operating carrier) starts with 'KL'
      // This excludes codeshares operated by other airlines (like HV, Transavia)
      return mainFlight.startsWith('KL')
    })
    const afterKLMFilter = filtered.length
    console.log(`KLM filter: ${beforeKLMFilter} → ${afterKLMFilter} flights (removed ${beforeKLMFilter - afterKLMFilter} codeshares)`)
  }

  if (filters.scheduleDate) {
    const targetDate = new Date(filters.scheduleDate).toISOString().split('T')[0]
    console.log(`Filtering by date: ${targetDate}`)
    
    const beforeDateFilter = filtered.length
    filtered = filtered.filter(flight => {
      // Try multiple ways to extract the flight date
      let flightDate = null
      
      if (flight.scheduleDateTime) {
        try {
          flightDate = new Date(flight.scheduleDateTime).toISOString().split('T')[0]
        } catch (e) {
          flightDate = flight.scheduleDateTime.split('T')[0]
        }
      } else if (flight.scheduleDate) {
        flightDate = flight.scheduleDate
      }
      
      // Debug logging for first few flights
      if (filtered.length < 5) {
        console.log(`Flight ${flight.flightName}: scheduleDateTime=${flight.scheduleDateTime}, scheduleDate=${flight.scheduleDate}, extracted=${flightDate}, target=${targetDate}`)
      }
      
      return flightDate === targetDate
    })
    
    const afterDateFilter = filtered.length
    console.log(`Date filter: ${beforeDateFilter} → ${afterDateFilter} flights (removed ${beforeDateFilter - afterDateFilter} date mismatches)`)
  }

  if (filters.isOperationalFlight !== undefined) {
    const beforeOperationalFilter = filtered.length
    filtered = filtered.filter(flight => {
      if (filters.isOperationalFlight === true) {
        return isOperationalFlight(flight)
      }
      return true
    })
    const afterOperationalFilter = filtered.length
    console.log(`Operational filter: ${beforeOperationalFilter} → ${afterOperationalFilter} flights (removed ${beforeOperationalFilter - afterOperationalFilter} non-operational)`)
  }

  console.log(`Total filtering: ${initialCount} → ${filtered.length} flights (removed ${initialCount - filtered.length} total)`)
  return filtered
}

/**
 * Remove duplicate flights, keeping the most recent one for each flight number
 */
export function removeDuplicateFlights(flights: SchipholFlight[]): SchipholFlight[] {
  const flightMap = new Map<number, SchipholFlight>()
  const initialCount = flights.length
  
  flights.forEach(flight => {
    const flightNumber = flight.flightNumber
    const existingFlight = flightMap.get(flightNumber)
    
    if (!existingFlight || new Date(flight.lastUpdatedAt) > new Date(existingFlight.lastUpdatedAt)) {
      flightMap.set(flightNumber, flight)
    }
  })
  
  const finalCount = flightMap.size
  console.log(`Deduplication: ${initialCount} → ${finalCount} flights (removed ${initialCount - finalCount} duplicates)`)
  
  return Array.from(flightMap.values())
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  const now = Date.now()
  const validEntries = Array.from(apiCache.values()).filter(entry => isCacheValid(entry.timestamp))
  
  return {
    totalEntries: apiCache.size,
    validEntries: validEntries.length,
    cacheDuration: CACHE_DURATION / 1000 / 60, // in minutes
    oldestEntry: apiCache.size > 0 ? Math.floor((now - Math.min(...Array.from(apiCache.values()).map(e => e.timestamp))) / 1000 / 60) : 0
  }
}

/**
 * Clear all cached data
 */
export function clearCache() {
  const clearedCount = apiCache.size
  apiCache.clear()
  return {
    message: 'Cache cleared successfully',
    clearedEntries: clearedCount
  }
} 