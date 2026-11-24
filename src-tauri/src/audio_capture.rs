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
const WINDOW_SIZE: usize = 256;
const TARGET_FREQS: [f32; NUM_BANDS] = [70.0, 150.0, 320.0, 680.0, 1400.0, 2800.0, 5400.0, 9500.0];

pub struct AudioSpectrumCapture {
    bands: Arc<Mutex<[f32; NUM_BANDS]>>,
}

impl AudioSpectrumCapture {
    pub fn start() -> Self {
        let bands = Arc::new(Mutex::new([0.0f32; NUM_BANDS]));
        let bands_bg = bands.clone();

        thread::spawn(move || {
            // Precompute Hann window once (zero trig inside hot loop)
            let mut hann = [0.0f32; WINDOW_SIZE];
            let inv_n = 1.0 / (WINDOW_SIZE as f32);
            for i in 0..WINDOW_SIZE {
                hann[i] = 0.5 * (1.0 - (2.0 * PI * (i as f32) * inv_n).cos());
            }

            loop {
                let _ = unsafe { run_loopback_session(&bands_bg, &hann) };
                if let Ok(mut b) = bands_bg.lock() {
                    *b = [0.0; NUM_BANDS];
                }
                thread::sleep(Duration::from_millis(1200));
            }
        });

        Self { bands }
    }

    pub fn get_bands(&self) -> [f32; NUM_BANDS] {
        self.bands.lock().map(|b| *b).unwrap_or([0.0; NUM_BANDS])
    }
}

fn compute_goertzel_bands(
    samples: &[f32],
    coeffs: &[f32; NUM_BANDS],
    hann: &[f32; WINDOW_SIZE],
) -> [f32; NUM_BANDS] {
    let n = samples.len().min(WINDOW_SIZE);
    if n < 32 {
        return [0.0; NUM_BANDS];
    }

    let mut out = [0.0f32; NUM_BANDS];
    let inv_n = 1.0 / (n as f32);

    for band_idx in 0..NUM_BANDS {
        let coeff = coeffs[band_idx];
        let mut s_prev = 0.0f32;
        let mut s_prev2 = 0.0f32;

        for i in 0..n {
            let s = samples[i] * hann[i] + coeff * s_prev - s_prev2;
            s_prev2 = s_prev;
            s_prev = s;
        }

        let power = (s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2).max(0.0);
        let mag = power.sqrt() * inv_n * 2.0;

        let boost = 4.2 + (band_idx as f32) * 1.15;
        out[band_idx] = (mag * boost).powf(0.72).clamp(0.0, 1.0);
    }

    out
}

unsafe fn run_loopback_session(
    bands: &Arc<Mutex<[f32; NUM_BANDS]>>,
    hann: &[f32; WINDOW_SIZE],
) -> windows::core::Result<()> {
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

    // Precompute Goertzel coefficients for this device's sample rate
    let mut coeffs = [0.0f32; NUM_BANDS];
    if sample_rate > 0.0 {
        for (i, &freq) in TARGET_FREQS.iter().enumerate() {
            let omega = 2.0 * PI * freq / sample_rate;
            coeffs[i] = 2.0 * omega.cos();
        }
    }

    let hns_duration = 600_000i64; // 60ms buffer
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

    let mut mono_buf: Vec<f32> = Vec::with_capacity(WINDOW_SIZE);
    let mut smoothed = [0.0f32; NUM_BANDS];
    let mut idle_ticks = 0u32;

    loop {
        thread::sleep(Duration::from_millis(45));

        let mut packet_length = match capture_client.GetNextPacketSize() {
            Ok(len) => len,
            Err(_) => break,
        };

        if packet_length == 0 {
            idle_ticks += 1;
            if idle_ticks > 2 {
                let mut any_nonzero = false;
                for v in smoothed.iter_mut() {
                    *v *= 0.7;
                    if *v < 0.01 {
                        *v = 0.0;
                    } else {
                        any_nonzero = true;
                    }
                }
                if any_nonzero || idle_ticks == 3 {
                    if let Ok(mut b) = bands.lock() {
                        *b = smoothed;
                    }
                }
            }
            if idle_ticks > 90 {
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
            if !is_silent && !data_ptr.is_null() && num_frames > 0 && mono_buf.len() < WINDOW_SIZE {
                let frame_count = (num_frames as usize).min(WINDOW_SIZE - mono_buf.len());
                if bits_per_sample == 32 {
                    let stride = channels * 4;
                    for f in 0..frame_count {
                        let base = data_ptr.add(f * stride);
                        // Use read_unaligned so misaligned WASAPI buffers never panic
                        let sample = std::ptr::read_unaligned(base as *const f32);
                        if sample.is_finite() {
                            mono_buf.push(sample.clamp(-1.0, 1.0));
                        }
                    }
                } else if bits_per_sample == 16 {
                    let stride = channels * 2;
                    for f in 0..frame_count {
                        let base = data_ptr.add(f * stride);
                        let sample = std::ptr::read_unaligned(base as *const i16);
                        mono_buf.push((sample as f32) / 32768.0);
                    }
                }
            }

            let _ = capture_client.ReleaseBuffer(num_frames);
            packet_length = capture_client.GetNextPacketSize().unwrap_or(0);
        }

        if !mono_buf.is_empty() {
            let raw = compute_goertzel_bands(&mono_buf, &coeffs, hann);
            for i in 0..NUM_BANDS {
                if raw[i] > smoothed[i] {
                    smoothed[i] = smoothed[i] * 0.35 + raw[i] * 0.65;
                } else {
                    smoothed[i] = smoothed[i] * 0.72 + raw[i] * 0.28;
                }
            }
        } else {
            for v in smoothed.iter_mut() {
                *v *= 0.7;
            }
        }

        if let Ok(mut b) = bands.lock() {
            *b = smoothed;
        }
    }

    let _ = audio_client.Stop();
    Ok(())
}
