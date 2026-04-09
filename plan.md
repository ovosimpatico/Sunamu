# Lyrics & Artwork API Reference
## Apple Music (`amp-api`) + Deezer Private (`gw-light`) 
> Reverse-engineered from `zhaarey/apple-music-downloader` source code + community research.
> Intended as AI context for building a Bluetooth lyrics visualizer daemon.

---

## APPLE MUSIC API

### Authentication

Apple Music uses **two separate tokens**:

| Token | Name | Required for | How to obtain |
|---|---|---|---|
| Anonymous Bearer JWT | `token` / `Authorization` | All catalog reads (search, metadata) | Auto-extracted from music.apple.com JS bundle |
| User session cookie | `media-user-token` | Lyrics, personalized endpoints | Manually copied from browser cookies |

#### Auto-extracting the Bearer Token (no account needed)

The anonymous JWT is embedded in Apple Music's public web player JavaScript bundle. It rotates periodically (days/weeks) but can be scraped automatically:

```
GET https://music.apple.com/
  → parse HTML for: /assets/index~[hash].js
  → GET https://music.apple.com/assets/index~[hash].js
  → regex: eyJh[^"]* (matches a base64 JWT starting with eyJh)
```

The extracted token is a standard JWT. Pass it as:
```
Authorization: Bearer <token>
```

#### Obtaining `media-user-token` (account required, for lyrics)

Manual steps:
1. Open https://music.apple.com in browser, log in
2. DevTools → Application → Storage → Cookies → https://music.apple.com
3. Copy cookie named `media-user-token`

The token is a long opaque string (>50 chars). It must be passed both as a cookie and as a header on some endpoints:
```
Cookie: media-user-token=<value>
Authorization: Bearer <anon_token>
Origin: https://music.apple.com
Referer: https://music.apple.com/
```

---

### Base URL

```
https://amp-api.music.apple.com/v1/
```

All requests require `Authorization: Bearer <token>` header.

---

### Storefront

The storefront is a lowercase country code, e.g. `us`, `gb`, `br`.  
Affects catalog availability and language of returned metadata.

---

### Search

```
GET /v1/catalog/{storefront}/search
```

Query params:
| Param | Type | Description |
|---|---|---|
| `term` | string | Search query |
| `types` | string | Comma-separated: `songs`, `albums`, `artists` |
| `l` | string | Language code, e.g. `en-US`, `pt-BR` |
| `limit` | int | Max results per type (default varies) |
| `offset` | int | Pagination offset |

Response shape:
```json
{
  "results": {
    "songs": {
      "data": [{ "id": "...", "type": "songs", "attributes": { ... } }]
    },
    "albums": { "data": [...] },
    "artists": { "data": [...] }
  }
}
```

---

### Get Song Metadata

```
GET /v1/catalog/{storefront}/songs/{songId}
```

Relevant attributes returned:
```json
{
  "data": [{
    "id": "1234567890",
    "attributes": {
      "name": "Track Name",
      "artistName": "Artist Name",
      "albumName": "Album Name",
      "durationInMillis": 213000,
      "artwork": {
        "url": "https://is1-ssl.mzstatic.com/image/thumb/{hash}/{w}x{h}bb.jpg",
        "width": 3000,
        "height": 3000
      },
      "playParams": { "id": "...", "kind": "song" }
    }
  }]
}
```

**Artwork URL trick:** The `url` field uses `{w}` and `{h}` as width/height placeholders. Replace with actual pixel values:
```
https://is1-ssl.mzstatic.com/image/thumb/<hash>/3000x3000bb.jpg
```
Supported sizes: any integer. Common: `100`, `500`, `1000`, `3000`.

---

### Get Album Metadata (includes animated artwork)

```
GET /v1/catalog/{storefront}/albums/{albumId}
```

Key attributes:
```json
{
  "attributes": {
    "artwork": { "url": "...", "width": 3000, "height": 3000 },
    "editorialVideo": {
      "motionSquareVideo1x1":  { "video": "https://....m3u8" },
      "motionTallVideo3x4":    { "video": "https://....m3u8" },
      "motionDetailSquare":    { "video": "https://....m3u8" },
      "motionDetailTall":      { "video": "https://....m3u8" }
    }
  }
}
```

#### Animated Artwork

The `video` fields are HLS M3U8 master playlist URLs. To get the highest quality MP4:

1. Fetch the M3U8 URL
2. Parse as HLS master playlist
3. Sort variants by `AVERAGE-BANDWIDTH` descending
4. Take the highest bandwidth variant stream URL

Animated artwork is only present for some albums (Apple editorial picks). Most albums will have an empty `editorialVideo` object — always check before fetching.

---

### Get Lyrics (requires `media-user-token`)

This is the core endpoint. The `lrcType` path segment determines what type of lyrics you get.

```
GET /v1/catalog/{storefront}/songs/{songId}/{lrcType}
    ?l={language}
    &extend=ttmlLocalizations
```

#### `lrcType` values:

| Value | Returns |
|---|---|
| `lyrics` | Standard line-by-line TTML |
| `syllable-lyrics` | Word-by-word TTML (not always available) |

#### Required headers:
```
Authorization: Bearer <anon_token>
Cookie: media-user-token=<user_token>
Origin: https://music.apple.com
Referer: https://music.apple.com/
```

#### Response shape:
```json
{
  "data": [{
    "attributes": {
      "ttml": "<tt xml:lang=\"en\" ...>...</tt>",
      "ttmlLocalizations": "<tt ...>...</tt>"
    }
  }]
}
```

The `ttml` field is a full TTML XML string. `ttmlLocalizations` holds translated/transliterated versions (e.g. romanizations for Korean/Japanese).

---

### TTML Format Reference

TTML (Timed Text Markup Language) is an XML format. Apple Music uses a custom namespace `itunes:`.

#### Detecting lyrics type from TTML:

```xml
<tt xml:lang="en" itunes:timing="Word" ...>   <!-- word-by-word -->
<tt xml:lang="en" itunes:timing="Line" ...>   <!-- line-by-line -->
<tt xml:lang="en" itunes:timing="None" ...>   <!-- unsynced / full text -->
```

Always check `itunes:timing` attribute on the root `<tt>` element first.

#### Line-by-line TTML structure:

```xml
<tt>
  <body>
    <div>
      <!-- each <p> is one line -->
      <p begin="0:00:13.000" end="0:00:17.000" itunes:key="L1">
        First lyric line here
      </p>
      <p begin="0:00:17.500" end="0:00:21.000" itunes:key="L2">
        Second lyric line here
      </p>
    </div>
  </body>
</tt>
```

Time format: `H:MM:SS.mmm` or `MM:SS.mmm` or `SS.mmm`

#### Word-by-word TTML structure (syllable-lyrics):

```xml
<tt itunes:timing="Word">
  <body>
    <div>
      <!-- each <p> is one line, each <span> is one word -->
      <p begin="0:00:13.000" end="0:00:17.000" itunes:key="L1">
        <span begin="0:00:13.000" end="0:00:13.800">Word</span>
        <span begin="0:00:13.900" end="0:00:14.400">by</span>
        <span begin="0:00:14.500" end="0:00:15.200">word</span>
      </p>
    </div>
  </body>
</tt>
```

Each `<span>` has `begin` and `end` timestamps. Spaces between words are sometimes represented as `CharData` text nodes between `<span>` elements, not as separate spans.

#### Translations & Transliterations (CJK tracks):

Stored in `<head><metadata><iTunesMetadata>`:

```xml
<tt>
  <head>
    <metadata>
      <iTunesMetadata>
        <translations>
          <translation xml:lang="en">
            <!-- text[@for] references a line's itunes:key -->
            <text for="L1" text="English translation of line 1"/>
          </translation>
        </translations>
        <transliterations>
          <transliteration xml:lang="en-Latn">
            <text for="L1" text="Romanized line 1"/>
          </transliteration>
        </transliterations>
      </iTunesMetadata>
    </metadata>
  </head>
  ...
</tt>
```

For word-by-word transliterations, the `<text>` element may contain child `<span>` elements with their own `begin` timestamps instead of a plain `text` attribute.

---

### Converting TTML to LRC format

Standard LRC timestamp format: `[MM:SS.xx]` (centiseconds, 2 digits)

For line-by-line: each `<p begin="...">` becomes one LRC line.

For word-by-word: Extended LRC uses inline timestamps:
```
[00:13.00]<00:13.00>Word <00:13.90>by <00:14.50>word
```
Format per word: `<MM:SS.xx>word_text`

---

## DEEZER PRIVATE API

Deezer has an undocumented internal API used by their own web player. It is not officially supported and may change without notice.

### Base URL

```
http://www.deezer.com/ajax/gw-light.php
```

All calls use POST with JSON body. Query params control method routing.

### Authentication

Deezer uses a session-based token system. **No account required** for basic access.

#### Get Anonymous API Token

```
POST http://www.deezer.com/ajax/gw-light.php
     ?api_version=1.0&api_token=null&input=3&method=deezer.getUserData
Body: {} (empty JSON)
```

Response:
```json
{
  "results": {
    "checkForm": "abc123xyz...",
    "USER": { "USER_ID": 0, ... }
  }
}
```

Extract `results.checkForm` — this is your `api_token` for all subsequent calls. It is a per-session token and must be refreshed periodically (when you get `error` responses).

#### Helper function pattern:
```python
API_BASE = 'http://www.deezer.com/ajax/gw-light.php'
session = requests.Session()  # important: keep session for cookies

def api_call(token, method, body=None):
    params = {
        'api_version': '1.0',
        'api_token': token,
        'input': '3',
        'method': method
    }
    resp = session.post(API_BASE, params=params, json=body or {})
    return resp.json()

# Init: get anonymous token
token = api_call('null', 'deezer.getUserData')['results']['checkForm']
```

**Important:** Use a persistent `requests.Session()` — Deezer uses session cookies that must persist across calls.

---

### Search for a Track

```
POST gw-light.php?method=deezer.pageSearch&api_token=<token>
Body: {
  "query": "artist track name",
  "start": 0,
  "nb": 10,
  "suggest": true,
  "artist_suggest": false,
  "top_tracks": false
}
```

Response contains `results.TRACK.data[]`, each with:
```json
{
  "SNG_ID": "12345678",
  "SNG_TITLE": "Track Name",
  "ART_NAME": "Artist Name",
  "ALB_ID": "98765432",
  "ALB_TITLE": "Album Title",
  "DURATION": "213"
}
```

Alternatively, use the **public Deezer API** (no auth) to search and get IDs:
```
GET https://api.deezer.com/search?q=artist:"{artist}" track:"{title}"
```
Returns `data[].id` which is the `SNG_ID` used in private API calls.

---

### Get Lyrics

```
POST gw-light.php?method=song.getLyrics&api_token=<token>
Body: { "sng_id": "12345678" }
```

Response:
```json
{
  "results": {
    "LYRICS_ID": "...",
    "LYRICS_SYNC_JSON": [
      {
        "lrc_timestamp": "[00:13.00]",
        "milliseconds": "13000",
        "duration": "4000",
        "line": "First lyric line"
      },
      ...
    ],
    "LYRICS_TEXT": "Full unsynced lyrics as plain text\n...",
    "LYRICS_COPYRIGHTS": "...",
    "LYRICS_WRITERS": "..."
  },
  "error": []
}
```

#### Key fields in `LYRICS_SYNC_JSON`:

| Field | Type | Description |
|---|---|---|
| `lrc_timestamp` | string | LRC-formatted timestamp `[MM:SS.xx]` |
| `milliseconds` | string | Start time in ms (as string, parse to int) |
| `duration` | string | Duration of this line in ms |
| `line` | string | Lyric text for this line |

**Note:** Deezer's lyrics are **line-by-line only** through this endpoint. True word-by-word timing is not available in the private API response — despite what earlier research suggested. The `LYRICS_SYNC_JSON` provides line-level timestamps, which is equivalent to standard LRC format.

If `LYRICS_SYNC_JSON` is empty or missing but `LYRICS_TEXT` is present, only unsynced lyrics are available for that track.

If `error` array is non-empty, lyrics are unavailable (track not in Deezer's catalog or no lyrics licensed).

---

### Get Track Info (for album ID, cover, etc.)

```
POST gw-light.php?method=song.getData&api_token=<token>
Body: { "sng_id": "12345678" }
```

Returns full track metadata including `ALB_ID`, `ALB_TITLE`, `ART_NAME`, `ALB_PICTURE` (cover hash).

#### Album Cover URL

Deezer cover art is served from their CDN using an MD5 hash:
```
https://e-cdns-images.dzcdn.net/images/cover/{ALB_PICTURE}/{size}x{size}-000000-80-0-0.jpg
```

Sizes: `56`, `250`, `500`, `1000`, `1500`

Example (1500px):
```
https://e-cdns-images.dzcdn.net/images/cover/a1b2c3d4e5f6.../1500x1500-000000-80-0-0.jpg
```

---

## LRCLIB API (Free fallback, no auth)

### Search

```
GET https://lrclib.net/api/search?artist_name={artist}&track_name={title}
```

### Get lyrics by metadata

```
GET https://lrclib.net/api/get
    ?artist_name={artist}&track_name={title}&album_name={album}&duration={seconds}
```

Response:
```json
{
  "id": 12345,
  "trackName": "...",
  "artistName": "...",
  "albumName": "...",
  "duration": 213.0,
  "instrumental": false,
  "plainLyrics": "Full text...",
  "syncedLyrics": "[00:13.00] First line\n[00:17.50] Second line\n..."
}
```

`syncedLyrics` is standard LRC format. `plainLyrics` is unsynced plain text.

---

## RECOMMENDED FETCH CHAIN (priority order)

```
1. Apple Music syllable-lyrics (TTML, word-by-word)
   → GET /v1/catalog/{sf}/songs/{id}/syllable-lyrics
   → requires media-user-token
   → check itunes:timing="Word" in response TTML

2. Apple Music lyrics (TTML, line-by-line)
   → GET /v1/catalog/{sf}/songs/{id}/lyrics
   → requires media-user-token
   → check itunes:timing="Line"

3. Deezer song.getLyrics (line-by-line LRC)
   → POST gw-light.php?method=song.getLyrics
   → LYRICS_SYNC_JSON array

4. LRCLIB syncedLyrics (line-by-line LRC)
   → GET /api/get?artist_name=...&track_name=...

5. LRCLIB plainLyrics / Apple Music timing="None"
   → Unsynced full text, display statically
```

---

## ARTWORK FETCH CHAIN (priority order)

```
1. Apple Music animated artwork (HLS video, album-specific)
   → editorialVideo.motionDetailSquare.video (1:1 ratio)
   → editorialVideo.motionDetailTall.video   (3:4 ratio)
   → Parse M3U8, pick highest bandwidth variant

2. Apple Music static artwork
   → attributes.artwork.url with {w}x{h} replaced by 3000x3000

3. Deezer album cover
   → e-cdns-images.dzcdn.net/images/cover/{ALB_PICTURE}/1500x1500-000000-80-0-0.jpg

4. iTunes Search API (no auth)
   → GET https://itunes.apple.com/search?term={artist}+{title}&entity=song
   → results[].artworkUrl100 → replace "100x100bb" with "3000x3000bb"
```

---

## TRACK IDENTIFICATION (AVRCP → API IDs)

AVRCP gives you: `artist`, `title`, `album` as strings.

To query Apple Music:
1. Use `GET /v1/catalog/{sf}/search?term={artist}+{title}&types=songs`
2. Match on `attributes.artistName` + `attributes.name`
3. Extract `id` for lyrics/artwork calls

To query Deezer:
1. `GET https://api.deezer.com/search?q=artist:"{artist}" track:"{title}"`
2. Extract `data[0].id` as `sng_id`

**Fuzzy matching note:** AVRCP metadata can have slight variations (feat. artists, punctuation, remaster suffixes). Normalize both strings to lowercase and strip parenthetical suffixes before matching.

---

## NOTES FOR IMPLEMENTATION

- Apple Music anonymous token expires and must be re-scraped — cache it and refresh on 401 responses
- Deezer `checkForm` token is per-session; if you get error responses, call `deezer.getUserData` again with `api_token=null` to refresh
- AVRCP playback position drifts after seek — do not accumulate position from delta updates; re-read absolute position from AVRCP on each metadata poll cycle
- Apple Music lyrics availability varies by region and licensing; always fall through to next source on empty/error response
- TTML parsing: watch for both `text` attribute on elements AND text node children — the source uses both patterns depending on track