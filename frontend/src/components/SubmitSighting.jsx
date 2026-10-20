import { useState } from 'react'

import * as api from '../api.js'

const SubmitSighting = ({ onSubmitted }) => {
  const [plate, setPlate] = useState('')
  const [photo, setPhoto] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    try {
      const sighting = await api.postSighting(plate, photo)
      setSuccess(`${sighting.plate} is the new top!`)
      setPlate('')
      setPhoto(null)
      event.target.reset()
      onSubmitted()
    } catch (err) {
      // 422: the backend reports what the current top is
      const extra = err.data?.currentTop ? ` (current top: ${err.data.currentTop})` : ''
      setError(`${err.message}${extra}`)
    }
  }

  return (
    <section className='card'>
      <h2>Upload a license plate</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder='AB123CD'
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
        />
        <input
          type='file'
          accept='image/jpeg,image/png,image/webp'
          onChange={(e) => setPhoto(e.target.files[0])}
        />
        <button type='submit'>Upload</button>
      </form>
      {error && <p className='error'>{error}</p>}
      {success && <p className='success'>{success}</p>}
    </section>
  )
}

export default SubmitSighting
