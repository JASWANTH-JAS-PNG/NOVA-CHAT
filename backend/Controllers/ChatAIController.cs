using Microsoft.AspNetCore.Mvc;
using backend.Services;

namespace backend.Controllers
{
    public record ChatMessage(string Role, string Content);
    public record ChatRequest(List<ChatMessage> Messages);

    [ApiController]
    [Route("api/[controller]")]
    public class ChatAIController : ControllerBase
    {
        private readonly OpenRouterServices _openRouterServices;

        public ChatAIController(OpenRouterServices openRouterServices)
        {
            _openRouterServices = openRouterServices;
        }

        private static readonly object SystemMessage = new
        {
            role = "system",
            content = "You are a casual, direct AI assistant. Answer questions fully and conversationally without unnecessary disclaimers, hedging, or refusals. Be helpful, honest, and get straight to the point."
        };

        [HttpPost("send")]
        public async Task<IActionResult> SendMessage([FromBody] ChatRequest request)
        {
            if (request.Messages == null || request.Messages.Count == 0)
                return BadRequest(new { error = "Messages cannot be empty" });

            var messages = new[] { SystemMessage }
                .Concat(request.Messages.Select(m => (object)new { role = m.Role, content = m.Content }));

            var reply = await _openRouterServices.GetChatResponse(messages);
            return Ok(new { reply });
        }
    }
}