import React, { useState } from "react";
import { ArrowUpDown, Droplets, RefreshCw, Search, Thermometer, Wind } from "lucide-react";
import { WeatherInfo } from "../../types/system";
import { IslandThemeTokens, WeatherIcon } from "./helpers";

interface WeatherTabProps {
  tokens: IslandThemeTokens;
  weather: WeatherInfo | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onSearchCity: (city: string) => void;
}

export const WeatherTab: React.FC<WeatherTabProps> = React.memo(
  ({ tokens, weather, loading, error, onRefresh, onSearchCity }) => {
    const [cityInput, setCityInput] = useState("");
    const { isLight, mutedText, primaryBtnCls, focusRing } = tokens;

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onSearchCity(cityInput.trim());
      setCityInput("");
    };

    return (
      <div className="w-full h-full grid grid-cols-12 gap-4 items-stretch">
        <div className="col-span-5 py-1 px-1 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <WeatherIcon icon={weather?.icon || "cloud-sun"} className="w-7 h-7" />
              <span className="text-3xl font-bold tabular-nums leading-none">
                {weather ? `${weather.temperature}°` : "--°"}
              </span>
            </div>
            <button
              onClick={onRefresh}
              disabled={loading}
              className={`p-1.5 rounded-lg transition-colors ${focusRing} ${
                isLight ? "text-zinc-600 hover:bg-zinc-200" : "text-zinc-400 hover:bg-zinc-800"
              }`}
              title="Refresh Weather"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div>
            <div className="text-sm font-semibold truncate">
              {weather ? weather.city : loading ? "Loading weather..." : "Weather Offline"}
            </div>
            <div className={`text-[11px] truncate mt-0.5 ${mutedText}`}>
              {error || (weather ? weather.condition : "Detecting current city")}
            </div>
            {error && (
              <button
                onClick={onRefresh}
                className={`mt-2 px-2.5 py-1 rounded-md text-[10px] font-semibold ${primaryBtnCls}`}
              >
                Retry
              </button>
            )}
          </div>

          <div className={`text-[10px] ${mutedText}`}>Open-Meteo Live</div>
        </div>

        <div className="col-span-7 flex flex-col justify-between gap-2.5">
          <form onSubmit={handleSubmit} className="grid grid-cols-[1fr_auto] gap-1.5">
            <div className="relative">
              <input
                type="text"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="Set city (e.g. Jakarta, Tokyo)..."
                className={`w-full h-7 text-[11px] rounded-lg pl-7 pr-2 border focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  isLight
                    ? "bg-white border-zinc-300 text-zinc-900 placeholder-zinc-500"
                    : "bg-[#141418] border-zinc-800 text-zinc-100 placeholder-zinc-500"
                }`}
              />
              <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2" />
            </div>
            <button
              type="submit"
              className={`h-7 px-3 rounded-lg text-[10px] font-semibold transition-all ${focusRing} ${primaryBtnCls}`}
            >
              Set
            </button>
          </form>

          <div
            className={`grid grid-cols-2 grid-rows-2 gap-px rounded-xl overflow-hidden flex-1 border ${
              isLight ? "bg-zinc-200 border-zinc-200" : "bg-zinc-800 border-zinc-800"
            }`}
          >
            <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
              <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                <Thermometer className="w-3 h-3" />
                <span>Feels Like</span>
              </div>
              <div className="text-xs font-semibold tabular-nums">
                {weather ? `${weather.feelsLike}°C` : "--"}
              </div>
            </div>

            <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
              <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                <Droplets className="w-3 h-3" />
                <span>Humidity</span>
              </div>
              <div className="text-xs font-semibold tabular-nums">
                {weather ? `${weather.humidity}%` : "--"}
              </div>
            </div>

            <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
              <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                <Wind className="w-3 h-3" />
                <span>Wind</span>
              </div>
              <div className="text-xs font-semibold tabular-nums">
                {weather ? `${weather.windSpeed} km/h` : "--"}
              </div>
            </div>

            <div className={`p-2.5 flex flex-col justify-between ${isLight ? "bg-white" : "bg-[#141418]"}`}>
              <div className={`flex items-center gap-1.5 text-[10px] ${mutedText}`}>
                <ArrowUpDown className="w-3 h-3" />
                <span>High / Low</span>
              </div>
              <div className="text-xs font-semibold tabular-nums">
                {weather ? `${weather.tempMax}° / ${weather.tempMin}°` : "--"}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
