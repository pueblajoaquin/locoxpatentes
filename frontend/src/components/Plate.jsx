import { formatPlate } from '../format.js'

export default function Plate ({ plate }) {
  return (
    <div className='plate-wrap'>
      <div className='plate'>
        <div className='plate-band'>ARGENTINA</div>
        <div className='plate-text'>{formatPlate(plate)}</div>
      </div>
    </div>
  )
}
