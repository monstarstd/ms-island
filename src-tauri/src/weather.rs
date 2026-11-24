use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherInfo {
    pub city: String,
    pub temperature: f64,
    #[serde(rename = "feelsLike")]
    pub feels_like: f64,
    pub humidity: i64,
    #[serde(rename = "windSpeed")]
    pub wind_speed: f64,
    #[serde(rename = "tempMax")]
    pub temp_max: f64,
    #[serde(rename = "tempMin")]
    pub temp_min: f64,
    pub condition: String,
    pub icon: String,
    #[serde(rename = "isDay")]
    pub is_day: bool,
}

#[derive(Debug, Deserialize)]
struct IpApiResponse {
    city: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct IpWhoResponse {
    city: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct GeocodeResponse {
    results: Option<Vec<GeocodeItem>>,
}

#[derive(Debug, Deserialize)]
struct GeocodeItem {
    name: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoResponse {
    current: OpenMeteoCurrent,
    daily: Option<OpenMeteoDaily>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: f64,
    relative_humidity_2m: i64,
    apparent_temperature: f64,
    weather_code: i64,
    wind_speed_10m: f64,
    is_day: i64,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoDaily {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

fn map_wmo_code(code: i64, is_day: bool) -> (&'static str, &'static str) {
    match code {
        0 => ("Clear Sky", if is_day { "sun" } else { "moon" }),
        1 => ("Mainly Clear", if is_day { "sun" } else { "moon" }),
        2 => ("Partly Cloudy", "cloud-sun"),
        3 => ("Overcast", "cloud"),
        45 | 48 => ("Foggy", "fog"),
        51 | 53 | 55 => ("Drizzle", "rain"),
        56 | 57 => ("Freezing Drizzle", "rain"),
        61 => ("Light Rain", "rain"),
        63 => ("Moderate Rain", "rain"),
        65 => ("Heavy Rain", "rain"),
        66 | 67 => ("Freezing Rain", "rain"),
        71 | 73 | 75 | 77 => ("Snow", "snow"),
        80..=82 => ("Rain Showers", "rain"),
        85 | 86 => ("Snow Showers", "snow"),
        95 | 96 | 99 => ("Thunderstorm", "storm"),
        _ => ("Cloudy", "cloud"),
    }
}

fn urlencode(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}

async fn resolve_location(client: &reqwest::Client, city_query: Option<&str>) -> Option<(String, f64, f64)> {
    if let Some(q) = city_query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let url = format!(
                "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en&format=json",
                urlencode(trimmed)
            );
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(geo) = resp.json::<GeocodeResponse>().await {
                    if let Some(first) = geo.results.and_then(|mut r| if r.is_empty() { None } else { Some(r.remove(0)) }) {
                        return Some((first.name, first.latitude, first.longitude));
                    }
                }
            }
            return None;
        }
    }

    // Auto-detect via ipwho.is (HTTPS)
    if let Ok(resp) = client.get("https://ipwho.is/").send().await {
        if let Ok(ip) = resp.json::<IpWhoResponse>().await {
            if let (Some(city), Some(lat), Some(lon)) = (ip.city, ip.latitude, ip.longitude) {
                return Some((city, lat, lon));
            }
        }
    }

    // Fallback: ip-api.com
    if let Ok(resp) = client.get("http://ip-api.com/json/?fields=city,lat,lon").send().await {
        if let Ok(ip) = resp.json::<IpApiResponse>().await {
            if let (Some(city), Some(lat), Some(lon)) = (ip.city, ip.lat, ip.lon) {
                return Some((city, lat, lon));
            }
        }
    }

    // Final sensible fallback: Jakarta
    Some(("Jakarta".to_string(), -6.2088, 106.8456))
}

pub async fn fetch_weather(city_query: Option<String>) -> Result<WeatherInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("MSIsland/0.1.0")
        .timeout(std::time::Duration::from_secs(7))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let (city, lat, lon) = resolve_location(&client, city_query.as_deref())
        .await
        .ok_or_else(|| "Location not found".to_string())?;

    let weather_url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1",
        lat, lon
    );

    let resp = client
        .get(&weather_url)
        .send()
        .await
        .map_err(|e| format!("Weather request failed: {}", e))?;

    let data: OpenMeteoResponse = resp
        .json()
        .await
        .map_err(|e| format!("Weather parse error: {}", e))?;

    let is_day = data.current.is_day == 1;
    let (condition, icon) = map_wmo_code(data.current.weather_code, is_day);

    let temp_max = data
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_max.first().copied())
        .unwrap_or(data.current.temperature_2m);

    let temp_min = data
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_min.first().copied())
        .unwrap_or(data.current.temperature_2m);

    Ok(WeatherInfo {
        city,
        temperature: data.current.temperature_2m.round(),
        feels_like: data.current.apparent_temperature.round(),
        humidity: data.current.relative_humidity_2m,
        wind_speed: (data.current.wind_speed_10m * 10.0).round() / 10.0,
        temp_max: temp_max.round(),
        temp_min: temp_min.round(),
        condition: condition.to_string(),
        icon: icon.to_string(),
        is_day,
    })
}
