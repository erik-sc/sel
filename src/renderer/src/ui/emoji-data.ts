export interface EmojiEntry {
  char: string
  /** Lower-case search keywords, space separated. */
  keywords: string
}

export interface EmojiGroup {
  name: string
  emojis: EmojiEntry[]
}

// One entry per line: the emoji followed by its keywords.
const RAW: Record<string, string> = {
  Smileys: `
😀 grinning face smile happy
😃 smiley face happy joy
😄 smile face happy laugh
😁 grin beaming teeth
😆 laughing satisfied haha
😅 sweat smile relief nervous
🤣 rofl rolling laughing floor
😂 joy tears laugh cry
🙂 slight smile
🙃 upside down silly
😉 wink
😊 blush smile shy
😇 innocent angel halo
🥰 love hearts adore
😍 heart eyes love crush
🤩 star struck excited wow
😘 kiss blow heart
😋 yum tasty delicious tongue
😛 tongue playful
😜 wink tongue crazy joke
🤪 zany goofy crazy
🤗 hug hugging
🤭 oops giggle hand mouth
🤫 shush quiet secret
🤔 thinking hmm consider
🤐 zipper mouth secret quiet
😐 neutral meh
😑 expressionless blank
😶 no mouth silent speechless
😏 smirk
😒 unamused annoyed
🙄 eye roll whatever
😬 grimace awkward
😌 relieved calm peaceful
😔 pensive sad thoughtful
😪 sleepy tired
😴 sleeping zzz sleep
😷 mask sick ill
🤒 thermometer fever sick
🤕 bandage hurt injured
🤢 nauseated sick green
🥵 hot heat sweating
🥶 cold freezing ice
🥴 woozy dizzy drunk
😵 dizzy knocked out
🤯 mind blown exploding head
🤠 cowboy hat
🥳 party celebrate birthday
😎 cool sunglasses
🤓 nerd glasses geek
🧐 monocle curious inspect
😕 confused
😟 worried concerned
🙁 frown sad
😮 open mouth surprised wow
😲 astonished shocked
😳 flushed embarrassed
🥺 pleading puppy eyes beg
😨 fearful scared
😰 anxious sweat nervous
😢 cry tear sad
😭 sob crying bawling
😱 scream fear shocked
😖 confounded frustrated
😞 disappointed sad
😓 downcast sweat hard work
😩 weary tired exhausted
😤 triumph huff steam frustrated
😡 pouting rage angry mad
😠 angry mad
🤬 cursing swearing angry
😈 devil smiling horns
💀 skull dead death
💩 poop pile
🤡 clown
👻 ghost halloween boo
👽 alien ufo
🤖 robot bot machine
😺 cat smile
`,
  People: `
👋 wave hello hi bye hand
🤚 raised back hand stop
✋ hand high five stop
🖖 vulcan spock
👌 ok okay perfect
🤏 pinch small tiny
✌️ victory peace two
🤞 fingers crossed luck hope
🤟 love you gesture
🤘 rock horns metal
🤙 call me shaka
👈 point left
👉 point right
👆 point up
👇 point down
👍 thumbs up like yes approve good
👎 thumbs down dislike no bad
✊ fist raised power
👊 fist bump punch
👏 clap applause bravo
🙌 raised hands hooray celebrate
👐 open hands
🤲 palms up prayer
🤝 handshake deal agreement
🙏 pray please thanks folded hands
✍️ writing hand write
💪 muscle strong flex biceps
🧠 brain mind think
👀 eyes look see watch
👁️ eye see
👄 mouth lips
👶 baby child
🧒 child kid
👦 boy
👧 girl
🧑 person adult
👨 man
👩 woman
🧓 older person senior
🧑‍💻 technologist developer programmer coder laptop
🧑‍🎓 student graduate
🧑‍🏫 teacher professor
🧑‍🍳 cook chef
🧑‍🔬 scientist lab
🧑‍🎨 artist painter
🧑‍🚀 astronaut space
🕵️ detective spy investigate
👷 construction worker builder
🧙 mage wizard magic
🧑‍🤝‍🧑 people holding hands friends team
👥 people silhouettes team group users
👤 person silhouette user profile
🏃 runner running run
🚶 walking walk
💃 dancer dancing
🧘 yoga meditation lotus calm
`,
  Nature: `
🐶 dog puppy pet
🐱 cat kitten pet
🐭 mouse
🐹 hamster
🐰 rabbit bunny
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger
🦁 lion
🐮 cow
🐷 pig
🐸 frog
🐵 monkey
🐔 chicken
🐧 penguin
🐦 bird
🦆 duck
🦉 owl wise
🦄 unicorn magic
🐝 bee honey
🦋 butterfly
🐌 snail slow
🐞 ladybug bug
🐢 turtle slow
🐍 snake python
🐙 octopus
🐠 fish tropical
🐬 dolphin
🐳 whale
🦈 shark
🐘 elephant
🦒 giraffe
🐎 horse
🐑 sheep
🐾 paw prints animal pet
🌵 cactus desert
🎄 christmas tree
🌲 evergreen tree pine forest
🌳 tree nature
🌴 palm tree beach
🌱 seedling sprout plant grow
🌿 herb leaf plant
☘️ shamrock clover
🍀 four leaf clover luck
🍁 maple leaf autumn fall
🍂 fallen leaves autumn
🍄 mushroom
🌷 tulip flower
🌹 rose flower
🌺 hibiscus flower
🌸 cherry blossom flower spring
🌼 blossom flower
🌻 sunflower
🌞 sun face sunny
🌝 full moon face
🌙 crescent moon night
⭐ star favourite
🌟 glowing star sparkle
✨ sparkles magic new shiny
⚡ lightning zap bolt fast energy
🔥 fire flame hot lit
💥 boom collision explosion
☀️ sun sunny weather
⛅ partly cloudy weather
☁️ cloud weather
🌧️ rain weather
⛈️ storm thunder weather
❄️ snowflake cold winter
⛄ snowman winter
🌈 rainbow
💧 droplet water
🌊 wave ocean sea water
🌍 earth globe world africa europe
🌎 earth globe world americas
🌏 earth globe world asia
🪐 planet saturn space
`,
  Food: `
🍏 green apple fruit
🍎 red apple fruit
🍐 pear fruit
🍊 orange tangerine fruit
🍋 lemon fruit
🍌 banana fruit
🍉 watermelon fruit
🍇 grapes fruit
🍓 strawberry fruit
🫐 blueberries fruit
🍒 cherries fruit
🍑 peach fruit
🥭 mango fruit
🍍 pineapple fruit
🥥 coconut
🥝 kiwi fruit
🍅 tomato
🥑 avocado
🥦 broccoli vegetable
🥕 carrot vegetable
🌽 corn
🌶️ chili pepper hot spicy
🥔 potato
🧄 garlic
🧅 onion
🍞 bread loaf
🥐 croissant
🥖 baguette bread
🧀 cheese
🥚 egg
🍳 cooking fried egg breakfast
🥞 pancakes breakfast
🥓 bacon
🍔 burger hamburger
🍟 fries chips
🍕 pizza
🌭 hot dog
🥪 sandwich
🌮 taco
🌯 burrito wrap
🥗 salad healthy
🍝 spaghetti pasta
🍜 ramen noodles
🍲 stew pot food
🍣 sushi
🍱 bento box lunch
🍚 rice
🍦 ice cream
🍩 doughnut donut
🍪 cookie
🎂 birthday cake
🍰 cake slice dessert
🧁 cupcake
🍫 chocolate
🍬 candy sweet
🍭 lollipop
🍯 honey
🥛 milk glass
☕ coffee hot drink cafe
🍵 tea cup
🧃 juice box
🥤 soda drink cup
🍺 beer
🍻 cheers beers
🥂 champagne toast clink
🍷 wine glass
🍸 cocktail
🧊 ice cube
🍽️ plate cutlery dinner meal
`,
  Activities: `
⚽ soccer football ball
🏀 basketball
🏈 american football
⚾ baseball
🎾 tennis
🏐 volleyball
🎱 pool billiards eight ball
🏓 ping pong table tennis
🏸 badminton
🥊 boxing glove
🥋 martial arts karate judo
⛳ golf flag
🎣 fishing
🎿 ski
🏂 snowboard
🏋️ weight lifting gym workout
🚴 cycling bike
🏊 swimming swim
🧗 climbing
🏆 trophy win award cup
🥇 gold medal first
🥈 silver medal second
🥉 bronze medal third
🏅 medal sports
🎖️ military medal honour
🎯 target bullseye goal dart
🎮 video game controller gaming
🕹️ joystick arcade game
🎲 dice game random
🧩 puzzle piece jigsaw
♟️ chess pawn strategy
🎨 art palette paint design
🎭 theatre masks drama
🎬 clapper movie film
🎤 microphone sing karaoke
🎧 headphones music listen
🎼 score music sheet
🎹 piano keyboard music
🥁 drum
🎷 saxophone
🎺 trumpet
🎸 guitar
🎻 violin
🎵 music note
🎶 music notes
🎪 circus tent
🎟️ ticket admission
🎉 party popper tada celebrate
🎊 confetti celebrate
🎈 balloon party
🎁 gift present wrapped
🎃 pumpkin halloween
`,
  Travel: `
🚗 car automobile
🚕 taxi cab
🚌 bus
🚎 trolleybus
🏎️ racing car fast
🚓 police car
🚑 ambulance
🚒 fire engine truck
🚚 delivery truck shipping
🚜 tractor farm
🚲 bicycle bike
🛵 scooter moped
🏍️ motorcycle
🚂 locomotive train steam
🚆 train rail
🚇 metro subway underground
✈️ airplane plane flight travel
🛫 departure takeoff flight
🛬 arrival landing flight
🚀 rocket launch ship startup
🛸 ufo flying saucer
🚁 helicopter
⛵ sailboat boat
🚢 ship cruise
⚓ anchor
🗺️ world map travel
🧭 compass navigation direction
🏔️ mountain snow
⛰️ mountain
🌋 volcano
🏕️ camping tent
🏖️ beach umbrella vacation
🏝️ island desert
🏜️ desert
🏠 house home
🏡 house garden home
🏢 office building work
🏥 hospital
🏦 bank
🏨 hotel
🏫 school
🏛️ classical building museum government
⛪ church
🏰 castle
🗼 tower tokyo
🗽 statue liberty new york
🌉 bridge night
🌃 night stars city
🏙️ cityscape city skyline
🎡 ferris wheel
🎢 roller coaster
⛲ fountain
🚦 traffic light
🚧 construction work in progress wip
⛽ fuel gas pump
`,
  Objects: `
⌚ watch time
📱 phone mobile smartphone
💻 laptop computer
⌨️ keyboard
🖥️ desktop computer monitor
🖨️ printer
🖱️ mouse computer
💽 disk minidisc
💾 floppy disk save
💿 cd disc
📷 camera photo
📸 camera flash photo
🎥 movie camera video
📺 television tv
📻 radio
🎙️ studio microphone podcast
⏰ alarm clock time
⏳ hourglass time waiting
⏱️ stopwatch timer
🔋 battery
🔌 plug electric
💡 light bulb idea
🔦 flashlight torch
🕯️ candle
🧯 fire extinguisher
💸 money wings spend
💵 dollar money cash
💰 money bag rich
💳 credit card payment
💎 gem diamond
⚖️ scales balance law justice
🧰 toolbox tools
🔧 wrench tool fix
🔨 hammer tool build
⚒️ hammer pick tools
🛠️ tools hammer wrench build
⛏️ pick mine
🔩 nut bolt
⚙️ gear settings cog
🧲 magnet
🔫 water pistol
💣 bomb
🔪 knife
🛡️ shield security protect
🔮 crystal ball future
🧿 nazar amulet
🧪 test tube experiment lab science
🧫 petri dish lab
🧬 dna genetics
🔬 microscope science
🔭 telescope astronomy
📡 satellite antenna
💉 syringe vaccine
💊 pill medicine
🩺 stethoscope doctor health
🚪 door
🛏️ bed sleep
🛋️ couch sofa
🚽 toilet
🚿 shower
🛁 bathtub
🧹 broom clean sweep
🧺 basket laundry
🧼 soap clean
🔑 key password
🗝️ old key
🔒 lock locked secure private
🔓 unlock open
🔐 locked key secure
📦 package box parcel shipping
🏷️ label tag
✉️ envelope mail letter email
📧 email e-mail
📨 incoming envelope mail
📩 envelope arrow mail send
📮 postbox mail
📥 inbox tray
📤 outbox tray
📜 scroll document history
📃 page curl document
📄 page document file
📑 bookmark tabs
📊 bar chart stats graph
📈 chart increasing growth up trend
📉 chart decreasing down trend
🗒️ notepad notes spiral
🗓️ calendar spiral schedule
📅 calendar date
📆 tear off calendar date
📇 card index contacts
🗃️ card file box archive
🗳️ ballot box vote
🗄️ file cabinet archive
📋 clipboard tasks
📁 folder directory
📂 open folder directory
🗂️ dividers index organise
🗞️ newspaper rolled news
📰 newspaper news
📓 notebook
📔 notebook decorative
📒 ledger notebook
📕 closed book red
📗 green book
📘 blue book
📙 orange book
📚 books library study
📖 open book read
🔖 bookmark
🧷 safety pin
🔗 link chain url
📎 paperclip attachment
🖇️ linked paperclips
📐 triangular ruler
📏 ruler measure
🧮 abacus calculate
📌 pushpin pin
📍 round pushpin location
✂️ scissors cut
🖊️ pen write
🖋️ fountain pen write
✒️ black nib pen
🖌️ paintbrush
🖍️ crayon
📝 memo note pencil write
✏️ pencil edit write
🔍 magnifying glass search find
🔎 magnifying glass right search
🗑️ wastebasket trash delete bin
🧳 luggage suitcase travel
👓 glasses
🎒 backpack school
👑 crown king queen
🎓 graduation cap education
`,
  Symbols: `
❤️ red heart love
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
🤎 brown heart
💔 broken heart
💕 two hearts love
💖 sparkling heart
💯 hundred perfect score
💢 anger
💬 speech bubble comment chat
💭 thought bubble thinking
🗯️ anger bubble
💤 zzz sleep
✅ check mark done complete yes
☑️ checkbox checked done
✔️ check mark tick
❌ cross mark no wrong delete
❎ cross button
➕ plus add
➖ minus remove
➗ divide
✖️ multiply times
❓ question mark
❔ white question
❗ exclamation mark important
❕ white exclamation
‼️ double exclamation
⚠️ warning caution alert
🚫 prohibited forbidden no
⛔ no entry stop
🔴 red circle
🟠 orange circle
🟡 yellow circle
🟢 green circle
🔵 blue circle
🟣 purple circle
⚫ black circle
⚪ white circle
🟥 red square
🟧 orange square
🟨 yellow square
🟩 green square
🟦 blue square
🟪 purple square
⬛ black square
⬜ white square
🔶 orange diamond
🔷 blue diamond
🔺 red triangle up
🔻 red triangle down
♻️ recycle
🔁 repeat loop
🔄 refresh sync arrows
➡️ arrow right
⬅️ arrow left
⬆️ arrow up
⬇️ arrow down
↗️ arrow up right
↘️ arrow down right
↩️ return arrow back
🔀 shuffle random
▶️ play
⏸️ pause
⏹️ stop
⏺️ record
⏭️ next track
⏮️ previous track
🔔 bell notification
🔕 bell muted silent
🔊 speaker loud volume
🔇 muted speaker
📣 megaphone announce
📢 loudspeaker announcement
ℹ️ information info
🆕 new
🆗 ok
🆘 sos help
🔝 top
🏁 chequered flag finish
🚩 red flag
🏳️ white flag
🏴 black flag
🏳️‍🌈 rainbow flag pride
#️⃣ hash number
©️ copyright
®️ registered
™️ trademark
`
}

export const EMOJI_GROUPS: EmojiGroup[] = Object.entries(RAW).map(([name, text]) => ({
  name,
  emojis: text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ')
      return space < 0
        ? { char: line, keywords: '' }
        : { char: line.slice(0, space), keywords: line.slice(space + 1) }
    })
}))

export const ALL_EMOJIS: EmojiEntry[] = EMOJI_GROUPS.flatMap((group) => group.emojis)
