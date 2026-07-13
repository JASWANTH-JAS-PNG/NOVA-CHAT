using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace backend.Services
{
    public class OpenRouterServices
    {
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;

        public OpenRouterServices(HttpClient httpClient, IConfiguration configuration)
        {
            _httpClient = httpClient;
            _configuration = configuration;
        }

        public async Task<string> GetChatResponse(IEnumerable<object> messages)
        {
            var apiKey = _configuration["OpenRouter:ApiKey"]
                ?? throw new InvalidOperationException("OpenRouter:ApiKey is not configured");
            var model = _configuration["OpenRouter:Model"] ?? "openai/gpt-4o-mini";

            var payload = new { model, messages, stream = false };
            var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var responseContent = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(responseContent);
            return doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? string.Empty;
        }
    }
}
