// "AF412KR" -> "AF 412 KR"
export const formatPlate = (plate) =>
  plate.replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1 $2 $3')

// milliseconds -> "2 d 6 h" / "3 h 5 min" / "4 min"
export const formatDuration = (ms) => {
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes % 60} min`
  return `${minutes} min`
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
