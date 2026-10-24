#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/*
 * PA_STREAM_DONT_MOVE is documented by PulseAudio's stream API:
 * https://www.freedesktop.org/software/pulseaudio/doxygen/def_8h.html
 */
#define PA_STREAM_DONT_MOVE 0x0200

typedef struct pa_stream pa_stream;
typedef struct pa_buffer_attr pa_buffer_attr;
typedef int (*pa_stream_connect_record_fn)(pa_stream *, const char *, const pa_buffer_attr *, int);

int pa_stream_connect_record(pa_stream *stream, const char *device,
                             const pa_buffer_attr *attr, int flags) {
    static pa_stream_connect_record_fn real_fn;
    const char *wanted = getenv("PULSE_SOURCE");
    if (!wanted || !device || strcmp(wanted, device) != 0) return -1;

    if (!real_fn) {
        /* ALSA may dlopen its Pulse plugin with a local symbol scope. */
        void *library = dlopen("libpulse.so.0", RTLD_NOW | RTLD_LOCAL);
        if (!library) return -1;
        void *symbol = dlsym(library, "pa_stream_connect_record");
        if (!symbol) return -1;
        memcpy(&real_fn, &symbol, sizeof(real_fn));
    }

    int result = real_fn(stream, device, attr, flags | PA_STREAM_DONT_MOVE);
    if (result < 0) return result;

    /* ALSA can prepare the same PCM repeatedly. Apply DONT_MOVE every time,
     * but never write to fd 3 again after its one-time handshake/close. */
    static int notified;
    if (notified) return result;
    static const char ready[] = "PTK_NO_MOVE_V1\n";
    ssize_t written = write(3, ready, sizeof(ready) - 1);
    int saved_errno = errno;
    close(3);
    if (written != (ssize_t)(sizeof(ready) - 1)) {
        errno = saved_errno;
        return -1;
    }
    notified = 1;
    return result;
}
