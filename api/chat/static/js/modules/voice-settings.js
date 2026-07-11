export function initVoiceSettings(context) {
    context.currentAudio = null;
    context.currentVoicePlaying = null;

    context.playVoiceSample = async function(voice) {
        if (this.currentVoicePlaying === voice && this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
            this.currentVoicePlaying = null;
            this.updatePlayIcons();
            return;
        }

        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
            this.currentVoicePlaying = null;
        }

        this.currentVoicePlaying = voice;
        this.updatePlayIcons();

        try {
            const response = await fetch('/api/chat/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: "Здравствуйте! Я ваш голосовой помощник. Как я могу вам помочь?",
                    voice: voice
                })
            });
            
            const data = await response.json();
            if (data.url) {
                const audio = new Audio(data.url);
                this.currentAudio = audio;

                audio.play().catch(e => {
                    console.error('Error playing sample:', e);
                    this.currentAudio = null;
                    this.currentVoicePlaying = null;
                    this.updatePlayIcons();
                });

                audio.onended = () => {
                    this.currentAudio = null;
                    this.currentVoicePlaying = null;
                    this.updatePlayIcons();
                };
            }
        } catch (e) {
            console.error('Error in playVoiceSample:', e);
            this.currentAudio = null;
            this.currentVoicePlaying = null;
            this.updatePlayIcons();
        }
    };

    context.updatePlayIcons = function() {
        document.querySelectorAll('.play-sample-icon').forEach(icon => {
            const btn = icon.closest('.voice-btn');
            if (!btn) return;
            const voice = btn.dataset.voiceVal;
            const isPlaying = this.currentVoicePlaying === voice;
            
            if (isPlaying) {
                icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                icon.classList.add('is-playing');
            } else {
                icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
                icon.classList.remove('is-playing');
            }
        });
    };

    const ttsToggle = document.getElementById('prompt-tts-enabled');
    const voiceGroup = document.getElementById('prompt-voice-group');
    
    const updateVisibility = (isEnabled) => {
        if (voiceGroup) {
            voiceGroup.style.display = isEnabled ? 'block' : 'none';
        }
    };

    if (ttsToggle) {
        ttsToggle.addEventListener('change', (e) => {
            updateVisibility(e.target.checked);
        });
    }

    const syncVoiceUI = () => {
        const isEnabled = context.state.bot_settings?.enable_tts || false;
        if (ttsToggle) ttsToggle.checked = isEnabled;
        updateVisibility(isEnabled);
        
        const currentVoice = context.state.bot_settings?.tts_voice;
        if (currentVoice) {
            document.querySelectorAll('#prompt-voice-group .voice-btn').forEach(btn => {
                if (btn.dataset.voiceVal === currentVoice) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    };

    window.syncVoiceUI = syncVoiceUI;

    window.addEventListener('config_loaded', () => {
        setTimeout(syncVoiceUI, 100);
    });

    context.setupToggle('prompt-tts-enabled', 'prompt-voice-group', 'bot_settings.enable_tts');

    const voiceInput = document.getElementById('prompt-voice-input');
    document.querySelectorAll('#prompt-voice-group .voice-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#prompt-voice-group .voice-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const val = btn.dataset.voiceVal;
            if (voiceInput) voiceInput.value = val;
            if (!context.state.bot_settings) context.state.bot_settings = {};
            context.state.bot_settings.tts_voice = val;
            context.syncWithWidget();
        };
    });

    window.playVoiceSample = (voice) => context.playVoiceSample(voice);
}
