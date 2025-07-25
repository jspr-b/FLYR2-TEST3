"use client"

import { useState, useEffect } from "react"
import { Building2, Info } from "lucide-react"

interface PierData {
  pier: string
  flights: number | null
  arrivals: number | null
  departures: number | null
  utilization: number | null
  status: "High" | "Medium" | "Low"
  type: "Schengen" | "Non-Schengen"
  purpose: string
}

interface FlightData {
  flightName: string
  flightNumber: number
  gate: string
  pier: string
  flightDirection: 'D' | 'A'
  scheduleDateTime: string
  publicFlightState: {
    flightStates: string[]
  }
}

interface HourlyDensity {
  hour: string
  flights: number
  intensity: number // 0-1 for color intensity
}

export function TerminalsChart() {
  const [selectedPier, setSelectedPier] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [pierData, setPierData] = useState<PierData[]>([])
  const [hourlyDensity, setHourlyDensity] = useState<Record<string, HourlyDensity[]>>({})
  const [showHourlyView, setShowHourlyView] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const today = new Date().toISOString().split('T')[0]
        const response = await fetch(`/api/flights?filters=%7B%22flightDirection%22%3A%22D%22%2C%22scheduleDate%22%3A%22${today}%22%2C%22isOperationalFlight%22%3Atrue%2C%22prefixicao%22%3A%22KL%22%7D`)
        if (!response.ok) {
          throw new Error('Failed to fetch flights data')
        }
        
        const data = await response.json()
        const flights: FlightData[] = data.flights || []
        
        // Calculate pier statistics from real flight data
        const pierStats = flights.reduce((acc, flight) => {
          let pierKey = flight.pier
          let type: "Schengen" | "Non-Schengen" = "Schengen"

          // Special handling for D pier
          if (flight.pier === "D" && flight.gate) {
            const gateNumber = parseInt(flight.gate.replace(/\D/g, ""))
            if (gateNumber >= 59 && gateNumber <= 87) {
              pierKey = "D-Schengen"
              type = "Schengen"
            } else if (gateNumber >= 1 && gateNumber <= 57) {
              pierKey = "D-Non-Schengen"
              type = "Non-Schengen"
            } else {
              // If gate number is not in range, keep as D
              pierKey = "D"
              type = "Schengen"
            }
          } else {
            // Determine type based on pier (simplified mapping)
            const schengenPiers = ["A", "B", "C"]
            type = schengenPiers.includes(flight.pier) ? "Schengen" : "Non-Schengen"
          }

          if (pierKey) {
            if (!acc[pierKey]) {
              acc[pierKey] = {
                pier: pierKey,
                flights: 0,
                arrivals: 0,
                departures: 0,
                utilization: 0,
                status: "Low" as const,
                type,
                purpose: "Mixed operations"
              }
            }

            acc[pierKey].flights += 1
            if (flight.flightDirection === 'A') {
              acc[pierKey].arrivals += 1
            } else {
              acc[pierKey].departures += 1
            }
          }
          return acc
        }, {} as Record<string, PierData>)
        
        // Calculate utilization and status for each pier
        const transformedPierData: PierData[] = Object.values(pierStats).map(pier => {
          // Simplified utilization calculation (flights per pier as percentage of total)
          const totalFlights = flights.length
          const utilization = totalFlights > 0 ? Math.round((pier.flights / totalFlights) * 100) : 0
          
          // Determine status based on utilization
          let status: "High" | "Medium" | "Low" = "Low"
          if (utilization > 20) status = "High"
          else if (utilization > 10) status = "Medium"
          
          return {
            ...pier,
            utilization,
            status,
            type: pier.type
          }
        }).sort((a, b) => (b.flights || 0) - (a.flights || 0))

        // Calculate hourly density for each pier
        const hourlyDensityData: Record<string, HourlyDensity[]> = {}
        
        Object.keys(pierStats).forEach(pierKey => {
          const pierFlights = flights.filter(flight => {
            let flightPierKey = flight.pier
            if (flight.pier === "D" && flight.gate) {
              const gateNumber = parseInt(flight.gate.replace(/\D/g, ""))
              if (gateNumber >= 59 && gateNumber <= 87) {
                flightPierKey = "D-Schengen"
              } else if (gateNumber >= 1 && gateNumber <= 57) {
                flightPierKey = "D-Non-Schengen"
              }
            }
            return flightPierKey === pierKey
          })

          // Group flights by hour
          const hourlyCounts: Record<string, number> = {}
          for (let hour = 6; hour <= 23; hour++) {
            const hourStr = hour.toString().padStart(2, '0')
            hourlyCounts[hourStr] = 0
          }

          pierFlights.forEach(flight => {
            try {
              const flightHour = new Date(flight.scheduleDateTime).getHours()
              const hourStr = flightHour.toString().padStart(2, '0')
              if (hourlyCounts[hourStr] !== undefined) {
                hourlyCounts[hourStr]++
              }
            } catch (error) {
              console.warn('Invalid date format:', flight.scheduleDateTime)
            }
          })

          // Convert to HourlyDensity format
          const maxFlightsInHour = Math.max(...Object.values(hourlyCounts))
          hourlyDensityData[pierKey] = Object.entries(hourlyCounts).map(([hour, count]) => ({
            hour: `${hour}:00`,
            flights: count,
            intensity: maxFlightsInHour > 0 ? count / maxFlightsInHour : 0
          }))
        })

        setPierData(transformedPierData)
        setHourlyDensity(hourlyDensityData)
        // Always select the first pier if none is selected
        if (!selectedPier && transformedPierData.length > 0) {
          setSelectedPier(transformedPierData[0].pier)
        }
      } catch (error) {
        console.error("Error fetching pier data:", error)
        // Fallback to placeholder data
        const fallbackPierData: PierData[] = [
          {
            pier: "D",
            flights: null,
            arrivals: null,
            departures: null,
            utilization: null,
            status: "Medium",
            type: "Schengen",
            purpose: "Mixed operations",
          },
          {
            pier: "B",
            flights: null,
            arrivals: null,
            departures: null,
            utilization: null,
            status: "Low",
            type: "Schengen",
            purpose: "Mixed operations",
          },
          {
            pier: "E",
            flights: null,
            arrivals: null,
            departures: null,
            utilization: null,
            status: "High",
            type: "Non-Schengen",
            purpose: "Long-haul operations",
          },
        ]
        setPierData(fallbackPierData)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [selectedPier])

  const maxFlights = Math.max(...pierData.map((d) => d.flights || 0))

  const getBarHeight = (flights: number | null) => {
    if (!flights || maxFlights === 0) return 8
    return Math.max((flights / maxFlights) * 200, 8)
  }

  const getUtilizationColor = (utilization: number | null, status: string, type: string) => {
    if (!utilization) return "bg-gray-300 hover:bg-gray-400"
    if (utilization > 20) return "bg-red-500 hover:bg-red-600"
    if (utilization > 10) return "bg-yellow-500 hover:bg-yellow-600"
    return "bg-green-500 hover:bg-green-600"
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "High":
        return "text-red-600 bg-red-50"
      case "Medium":
        return "text-yellow-600 bg-yellow-50"
      case "Low":
        return "text-green-600 bg-green-50"
      default:
        return "text-gray-600 bg-gray-50"
    }
  }

  const formatValue = (value: number | null) => {
    return value !== null ? value.toString() : "n/v"
  }

  const getIntensityColor = (intensity: number) => {
    if (intensity === 0) return 'bg-gray-100'
    if (intensity < 0.3) return 'bg-green-200'
    if (intensity < 0.6) return 'bg-yellow-300'
    if (intensity < 0.8) return 'bg-orange-400'
    return 'bg-red-500'
  }

  const getIntensityTextColor = (intensity: number) => {
    if (intensity === 0) return 'text-gray-400'
    if (intensity < 0.3) return 'text-green-800'
    if (intensity < 0.6) return 'text-yellow-800'
    if (intensity < 0.8) return 'text-orange-800'
    return 'text-white'
  }

  // Add this function to map intensity to a blue color class
  const getBlueBarColor = (intensity: number) => {
    if (intensity === 0) return 'bg-blue-100';
    if (intensity < 0.2) return 'bg-blue-200';
    if (intensity < 0.4) return 'bg-blue-300';
    if (intensity < 0.6) return 'bg-blue-400';
    if (intensity < 0.8) return 'bg-blue-500';
    if (intensity < 0.95) return 'bg-blue-700';
    return 'bg-blue-900';
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 min-h-[500px] lg:min-h-[600px] animate-pulse">
        <div className="h-6 bg-gray-200 rounded mb-4"></div>
        <div className="h-4 bg-gray-200 rounded mb-6"></div>
        <div className="flex items-end justify-center gap-4 h-80">
          {[...Array(8)].map((_, index) => (
            <div key={index} className="w-16 bg-gray-200 rounded-t" style={{ height: `${Math.random() * 200 + 8}px` }}></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 min-h-[500px] lg:min-h-[600px]">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Pier Usage Overview</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowHourlyView(false)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                !showHourlyView 
                  ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setShowHourlyView(true)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                showHourlyView 
                  ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Hourly
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          {showHourlyView ? 'Click a pier in the daily view to see its hourly breakdown, or view all piers combined' : 'Click bars for detailed breakdown'}
        </p>
      </div>

      {!showHourlyView ? (
        <div className="relative mb-8">
          {/* Chart Area - Responsive for all screen sizes */}
          <div className="relative overflow-x-auto">
            <div className="flex items-end justify-center min-w-[600px] sm:min-w-0 gap-3 sm:gap-4 md:gap-6 lg:gap-8 h-80 lg:h-96 mb-8 px-2">
              {pierData.map((data, index) => {
                const isSelected = selectedPier === data.pier
                const height = getBarHeight(data.flights)
                const colorClass = getUtilizationColor(data.utilization, data.status, data.type)

                return (
                  <div key={index} className="flex flex-col items-center group cursor-pointer">
                    <div className="text-center mb-2">
                      <span className="text-xs sm:text-sm font-medium text-gray-900">{formatValue(data.flights)}</span>
                      <span className="text-xs text-gray-500 block">flights</span>
                    </div>
                    <div
                      className={`w-12 sm:w-16 md:w-20 rounded-t transition-all duration-200 ${colorClass} ${
                        isSelected ? "ring-2 ring-blue-500 ring-offset-2" : ""
                      }`}
                      style={{ height: `${height}px` }}
                      onClick={() => setSelectedPier(isSelected ? null : data.pier)}
                      title={`${data.pier}: ${formatValue(data.flights)} flights (${formatValue(data.utilization)}% utilization)`}
                    />
                    <div className="mt-3 text-center">
                      <span className="text-xs sm:text-sm font-medium text-gray-900 block">
                        {data.pier}
                      </span>
                      <span
                        className={`inline-block px-1.5 sm:px-2 py-1 rounded-full text-xs font-medium mt-1 ${getStatusColor(data.status)}`}
                      >
                        {formatValue(data.utilization)}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Y-axis labels */}
          <div className="absolute left-2 top-0 h-64 flex flex-col justify-between text-xs text-gray-500"></div>
        </div>
      ) : (
        <div className="mb-8">
          {/* Hourly Density Bar Chart */}
          <div className="relative overflow-x-auto">
            <div className="flex items-end justify-center min-w-[800px] sm:min-w-0 gap-1 sm:gap-2 md:gap-3 lg:gap-4 h-80 lg:h-96 mb-8 px-2">
              {Array.from({ length: 18 }, (_, i) => i + 6).map(hour => {
                const hourStr = hour.toString().padStart(2, '0')
                // Always show only the selected pier's data
                let flights = 0
                let intensity = 0
                const selectedPierData = selectedPier ? hourlyDensity[selectedPier] || [] : []
                const hourData = selectedPierData.find(h => h.hour === `${hourStr}:00`)
                flights = hourData?.flights || 0
                intensity = hourData?.intensity || 0
                // Calculate height based on flights (similar to daily view)
                const maxFlightsInHour = Math.max(...Object.values(hourlyDensity).flatMap(pierData => 
                  pierData.map(h => h.flights)
                ))
                const height = maxFlightsInHour > 0 ? Math.max((flights / maxFlightsInHour) * 200, 8) : 8
                return (
                  <div key={hour} className="flex flex-col items-center group cursor-pointer">
                    <div className="text-center mb-2">
                      <span className="text-xs sm:text-sm font-medium text-gray-900">{flights}</span>
                      <span className="text-xs text-gray-500 block">flights</span>
                    </div>
                    <div
                      className={`w-8 sm:w-10 md:w-12 lg:w-14 rounded-t transition-all duration-200 ${getBlueBarColor(intensity)} ${
                        selectedPier ? "ring-2 ring-blue-300 ring-offset-2" : ""
                      }`}
                      style={{ height: `${height}px` }}
                      title={`${hourStr}:00 - ${flights} flights${selectedPier ? ` at ${selectedPier}` : ''}`}
                    />
                    <div className="mt-3 text-center">
                      <span className="text-xs sm:text-sm font-medium text-gray-900 block">
                        {hourStr}
                      </span>
                      <span className="text-xs text-gray-500 block">
                        {hourStr}:00
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Hourly Summary */}
          <div className="text-center mb-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              {selectedPier && `Hourly Flight Distribution - Pier ${selectedPier}`}
            </h3>
            <div className="flex justify-center gap-4 text-xs text-gray-600">
              <span>Peak Hour: {(() => {
                const pierData = selectedPier ? hourlyDensity[selectedPier] || [] : []
                const peakHour = pierData.reduce((max, current) => 
                  current.flights > max.flights ? current : max, 
                  { hour: '00:00', flights: 0, intensity: 0 }
                )
                return peakHour.hour
              })()}</span>
              <span>Total Flights: {(() => {
                const pierData = selectedPier ? hourlyDensity[selectedPier] || [] : []
                return pierData.reduce((sum, hour) => sum + hour.flights, 0)
              })()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Selected Terminal Details */}
      {selectedPier && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-900 mb-2">Pier {selectedPier} Details</h3>
              {(() => {
                const data = pierData.find((d) => d.pier === selectedPier)
                if (!data) return null
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-blue-700 font-medium">Total Flights:</span>
                      <p className="text-blue-900">{formatValue(data.flights)}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Arrivals:</span>
                      <p className="text-blue-900">{formatValue(data.arrivals)}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Departures:</span>
                      <p className="text-blue-900">{formatValue(data.departures)}</p>
                    </div>
                    <div>
                      <span className="text-blue-700 font-medium">Utilization:</span>
                      <p className="text-blue-900">{formatValue(data.utilization)}%</p>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs">
        {!showHourlyView ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span className="text-gray-600">Low Utilization (&lt;10%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded"></div>
              <span className="text-gray-600">Medium Utilization (10-20%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded"></div>
              <span className="text-gray-600">High Utilization (&gt;20%)</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-gray-600">Hourly flight count</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-600 rounded"></div>
              <span className="text-gray-600">Hover state</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-300 rounded ring-2 ring-blue-300 ring-offset-2"></div>
              <span className="text-gray-600">Selected pier</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
