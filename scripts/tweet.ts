require('dotenv').config()
import fetch from 'isomorphic-fetch'
import { Coord } from 'decentraland-ui'
import Twitter from 'twitter'
import axios from 'axios'

const previous = require('../data/deployments.json')
let prevCount = Object.keys(previous).length

const client = new Twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token_key: process.env.ACCESS_TOKEN_KEY,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
})

type ScenesResponse = {
  data: {
    parcel_id: string
    root_cid: string
    scene_cid: string
  }[]
}

type Scene = {
  display: {
    title: string
    favicon: string
  }
  owner: string
  contact: {
    name: string
    email: string
  }
  main: string
  tags: []
  scene: {
    parcels: ['-81,-118']
    base: string
  }
  communications: {
    type: string
    signalling: string
  }
  policy: {
    contentRating: string
    fly: boolean
    voiceEnabled: boolean
    blacklist: string[]
    teleportPosition: string
  }
  source: {
    origin: string
    projectId: string
  }
}

async function batch(
  nw: Coord,
  se: Coord,
  deployments: Map<string, string>,
  differences: Map<string, string>,
  failures: { nw: Coord; se: Coord }[]
) {
  const url = 'https://content.decentraland.org'
  const req = `${url}/scenes?x1=${nw.x}&x2=${se.x}&y1=${nw.y}&y2=${se.y}`
  try {
    const res = await fetch(req)
    const { data } = (await res.json()) as ScenesResponse
    for (const mapping of data) {
      const { parcel_id, root_cid, scene_cid } = mapping
      if (previous[parcel_id] !== root_cid) {
        differences.set(parcel_id, scene_cid)
      }
      deployments.set(parcel_id, root_cid)
    }
  } catch (e) {
    failures.push({ nw, se })
    console.log(`Error [nw=${nw.x},${nw.y} se=${se.x},${se.y}] ${e.message}`)
  }
}

async function main() {
  const deployments = new Map<string, string>()
  const differences = new Map<string, string>()

  console.log('fetching map data...')
  const size = 13
  let progress = 0
  let total = 90601
  let failures: { nw: Coord; se: Coord }[] = []
  for (let x = -150; x < 150; x += size) {
    for (let y = 150; y > -150; y -= size) {
      let nw = { x, y }
      let se = { x: Math.min(nw.x + size, 150), y: Math.max(nw.y - size, -150) }
      console.log(
        `${((progress / total) * 100).toFixed(2)}% - ${
          deployments.size
        } LAND (${failures.length} failures) (${differences.size} differences)`
      )
      await batch(nw, se, deployments, differences, failures)
      progress += (se.x - nw.x) * (nw.y - se.y)
    }
  }
  while (failures.length > 0) {
    const { nw, se } = failures.pop()
    console.log(
      `Retrying [nw=${nw.x},${nw.y} se=${se.x},${se.y}] (${failures.length} failures) (${differences.size} differences)`
    )
    await batch(nw, se, deployments, differences, failures)
  }

  console.log('writing map data...')
  const deploymentsFilename = 'deployments.json'
  let newCount = 0
  const deploymentsData = Array.from(deployments.entries()).reduce(
    (obj, [id, cid]) => {
      obj[id] = cid
      newCount++
      return obj
    },
    {}
  )
  require('fs').writeFileSync(
    `data/${deploymentsFilename}`,
    JSON.stringify(deploymentsData, null, 2),
    'utf8'
  )

  console.log('done ✅')

  console.log('finding differences...')
  const differencesData = Array.from(differences.entries()).reduce<
    Record<string, string>
  >((obj, [id, cid]) => {
    obj[id] = cid
    return obj
  }, {})

  const cids = new Set(Object.values(differencesData))
  console.log(`${cids.size} differences`)
  for (const cid of cids.values()) {
    try {
      const response = await axios.get<Scene>(
        `https://content.decentraland.org/contents/${cid}`
      )
      const scene = response.data
      if (scene && scene.source && scene.source.projectId) {
        console.log(`builder project found!`)
        console.log(`id: ${scene.source.projectId}`)

        const previewUrl = `https://builder-api.decentraland.org/v1/projects/${scene.source.projectId}/media/preview.png`

        console.log(`fetching ${previewUrl}`)
        const image = await axios.get(previewUrl + '?' + Date.now(), {
          responseType: 'arraybuffer'
        })
        const data = Buffer.from(image.data)

        // Make post request on media endpoint. Pass file data as media parameter
        console.log(`Posting media: ${data.length} bytes`)
        const media = await client.post('media/upload', { media: data })

        const parcelIds = Object.keys(differencesData)
        const coords = parcelIds.find(id => differencesData[id] === cid)
        const parcels = parcelIds.reduce(
          (total, id) => (differencesData[id] === cid ? total + 1 : total),
          0
        )

        const text = `New scene deployed 🚀! 

Coords: ${coords}
Size: ${parcels} parcel${parcels === 1 ? '' : 's'}

#decentraland`

        const status = {
          status: text,
          media_ids: media.media_id_string // Pass the media id string
        }
        console.log(`posting tweet for media id: ${media.media_id_string}`)

        const tweet = await client.post('statuses/update', status)
        console.log(`success! Tweet id: ${tweet.id}`)

        console.log('waiting 10 seconds...')
        await new Promise(resolve => setTimeout(resolve, 10000))
      } else {
        console.log(`not builder project...`)
      }
    } catch (e) {
      console.log(`Error! ${e.message}`)
    }
  }

  console.log('done ✅')
  console.log('Prev count:', prevCount)
  console.log('New count:', newCount)
  if (newCount > prevCount) {
    prevCount = newCount
    try {
      console.log('Count increased to ' + newCount + ' LAND')
      const text = `There are ${newCount.toLocaleString()} LAND with content deployed on them!`

      const status = {
        status: text
      }
      console.log(`posting tweet with new count`)

      const tweet = await client.post('statuses/update', status)

      console.log(`success! tweet id ${tweet.id}`)
    } catch (e) {
      console.log(`Error! ${e.message}`)
    }
  }
}

var crontab = require('node-crontab')
// every 6 hours
console.log('sabe')
crontab.scheduleJob('0 */6 * * *', function() {
  console.log('go!')
  main().catch(console.error)
})
