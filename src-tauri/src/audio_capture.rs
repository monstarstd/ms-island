use std::f32::consts::PI;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const NUM_BANDS: usize = 8;
const TARGET_FREQS: [f32; NUM_BANDS] = [70.0, 150.0, 320.0, 680.0, 1400.0, 2800.0, 5400.0, 9500.0];

pub struct AudioSpectrumCapture {
    bands: Arc<Mutex<[f32; NUM_BANDS]>>,
}

impl AudioSpectrumCapture {
    pub fn start() -> Self {
        let bands = Arc::new(Mutex::new([0.0f32; NUM_BANDS]));
        let bands_bg = bands.clone();

        thread::spawn(move || {
            loop {
                let _ = unsafe { run_loopback_session(&bands_bg) };
                // Decay to zero if capture restarts (e.g. audio device switched)
                if let Ok(mut b) = bands_bg.lock() {
                    *b = [0.0; NUM_BANDS];
                }
                thread::sleep(Duration::from_millis(800));
            }
        });

        Self { bands }
    }

    pub fn get_bands(&self) -> [f32; NUM_BANDS] {
        self.bands.lock().map(|b| *b).unwrap_or([0.0; NUM_BANDS])
    }
}

/// Computes energy at 8 logarithmically spaced frequencies using the Goertzel algorithm
fn compute_goertzel_bands(samples: &[f32], sample_rate: f32) -> [f32; NUM_BANDS] {
    let n = samples.len().min(512);
    if n < 32 || sample_rate <= 0.0 {
        return [0.0; NUM_BANDS];
    }

    let mut out = [0.0f32; NUM_BANDS];
    let inv_n = 1.0 / (n as f32);

    for (band_idx, &freq) in TARGET_FREQS.iter().enumerate() {
        let omega = 2.0 * PI * freq / sample_rate;
        let coeff = 2.0 * omega.cos();
        let mut s_prev = 0.0f32;
        let mut s_prev2 = 0.0f32;

        for i in 0..n {
            // Hann window to avoid spectral leakage
            let w = 0.5 * (1.0 - (2.0 * PI * (i as f32) * inv_n).cos());
            let s = samples[i] * w + coeff * s_prev - s_prev2;
            s_prev2 = s_prev;
            s_prev = s;
        }

        let power = (s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2).max(0.0);
        let mag = power.sqrt() * inv_n * 2.0;

        // Perceptual frequency boost (higher frequencies naturally have lower amplitude in music)
        let boost = 4.2 + (band_idx as f32) * 1.15;
        let normalized = (mag * boost).powf(0.72).clamp(0.0, 1.0);
        out[band_idx] = normalized;
    }

    out
}

unsafe fn run_loopback_session(bands: &Arc<Mutex<[f32; NUM_BANDS]>>) -> windows::core::Result<()> {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let audio_client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;

    let mix_format_ptr = audio_client.GetMixFormat()?;
    if mix_format_ptr.is_null() {
        return Ok(());
    }

    let sample_rate = (*mix_format_ptr).nSamplesPerSec as f32;
    let channels = (*mix_format_ptr).nChannels.max(1) as usize;
    let bits_per_sample = (*mix_format_ptr).wBitsPerSample;

    // 50ms buffer duration (in 100ns units)
    let hns_duration = 500_000i64;
    let init_res = audio_client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        hns_duration,
        0,
        mix_format_ptr,
        None,
    );
    CoTaskMemFree(Some(mix_format_ptr as *const _));
    init_res?;

    let capture_client: IAudioCaptureClient = audio_client.GetService()?;
    audio_client.Start()?;

    let mut mono_buf: Vec<f32> = Vec::with_capacity(1024);
    let mut smoothed = [0.0f32; NUM_BANDS];
    let mut idle_ticks = 0u32;

    loop {
        thread::sleep(Duration::from_millis(28));

        let mut packet_length = match capture_client.GetNextPacketSize() {
            Ok(len) => len,
            Err(_) => break,
        };

        if packet_length == 0 {
            idle_ticks += 1;
            // Gently decay bars to zero during silence
            if idle_ticks > 2 {
                for v in smoothed.iter_mut() {
                    *v *= 0.72;
                    if *v < 0.01 {
                        *v = 0.0;
                    }
                }
                if let Ok(mut b) = bands.lock() {
                    *b = smoothed;
                }
            }
            // Periodically check if default audio endpoint changed (every ~3s of silence)
            if idle_ticks > 110 {
                break;
            }
            continue;
        }

        idle_ticks = 0;
        mono_buf.clear();

        while packet_length > 0 {
            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut num_frames: u32 = 0;
            let mut flags: u32 = 0;

            if capture_client
                .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                .is_err()
            {
                let _ = audio_client.Stop();
                return Ok(());
            }

            let is_silent = (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0;
            if !is_silent && !data_ptr.is_null() && num_frames > 0 {
                let frame_count = num_frames as usize;
                if bits_per_sample == 32 {
                    let floats = std::slice::from_raw_parts(
                        data_ptr as *const f32,
                        frame_count * channels,
                    );
                    for f in 0..frame_count {
                        let mut sum = 0.0f32;
                        for c in 0..channels {
                            sum += floats[f * channels + c];
                        }
                        mono_buf.push(sum / (channels as f32));
                    }
                } else if bits_per_sample == 16 {
                    let ints = std::slice::from_raw_parts(
                        data_ptr as *const i16,
                        frame_count * channels,
                    );
                    for f in 0..frame_count {
                        let mut sum = 0.0f32;
                        for c in 0..channels {
                            sum += (ints[f * channels + c] as f32) / 32768.0;
                        }
                        mono_buf.push(sum / (channels as f32));
                    }
                }
            }

            let _ = capture_client.ReleaseBuffer(num_frames);
            packet_length = capture_client.GetNextPacketSize().unwrap_or(0);
        }

        if !mono_buf.is_empty() {
            let raw = compute_goertzel_bands(&mono_buf, sample_rate);
            for i in 0..NUM_BANDS {
                // Fast attack, smooth decay for tactile hardware feel
                if raw[i] > smoothed[i] {
                    smoothed[i] = smoothed[i] * 0.35 + raw[i] * 0.65;
                } else {
                    smoothed[i] = smoothed[i] * 0.75 + raw[i] * 0.25;
                }
            }
        } else {
            for v in smoothed.iter_mut() {
                *v *= 0.72;
            }
        }

        if let Ok(mut b) = bands.lock() {
            *b = smoothed;
        }
    }

    let _ = audio_client.Stop();
    Ok(())
}
