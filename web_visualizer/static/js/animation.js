// animate : Dict Dict Map -> _
// Using the _client_ & _server_ data retrieved upon the request, animates the routes on _map_
async function animate(client_data, server_data) {

  zoom_to_bounds({ longitude: client_data.ip_details.longitude, latitude: client_data.ip_details.latitude},
                 { longitude: server_data.ip_details.longitude, latitude: server_data.ip_details.latitude});

  display_server(server_data);

  const numPackets = $('input#num-packets').val();
  
  // Generate and animate routes in both directions
  const routeAnimation = new RouteAnimation(client_data, server_data, numPackets);

  document.querySelector("#stop-animation").addEventListener('click', (e) => {
    e.preventDefault();
    stop_animation(routeAnimation.infoWindow);
  });


  await routeAnimation.animate("request");
  await routeAnimation.animate("response");

  clear_lines(routeAnimation.blurred_lines);
  stop_animation();
}


class RouteAnimation {
  constructor(client_data, server_data, num_routes) {
    this.client_data = client_data;
    this.server_data = server_data;
    this.num_routes = num_routes;
    this.routes = [];
    this.blurred_lines = [];
  }
  // animate : Direction -> _
  // Provide a one-way animation of an HTTP-request
  async animate(direction) {

    loadingSpinner.style.zIndex = 0;

    if (animation_flag) {
      // Initialize the content of the info window
      if (direction == "request")
        this.infoWindow = await init_info_window(destinationMarker);
      else
        this.infoWindow = await init_info_window(userMarker);

      this.update_info_window(direction, 0);
      await this.animate_routes(direction);
      loadingSpinner.style.zIndex = 0;
      clear_lines(this.blurred_lines);
      this.routes = [];
      this.blurred_lines = [];

      // Close info window
      this.infoWindow.close()
    }

    clear_lines(this.blurred_lines);

  }
  // update_info_window : Direction Number -> _
  // Update the info window in realtime to match the request on its current packet _packet_number_
  update_info_window(direction, packet_number) {

    if (animation_flag) {
      const data = {
        total_packets: this.num_routes,
        packets_received: packet_number,
        client_data: this.client_data,
        server_data: this.server_data
      };


      let content = info_window_content(direction, data);
      this.infoWindow.setContent(content);
    }
  }
  
  // animate_routes : Direction -> _
  // Initialize the animation of routes in _direction_
  async animate_routes(direction, starting_index) {
    if (!starting_index) starting_index = 0;
    return new Promise(resolve => {
      for (let i = starting_index; i < this.num_routes; i++) {
        $.ajax({
          dataType: "json",
          url: $SCRIPT_ROOT + "/route",
          data: { direction },
          success: (route) => {
            loadingSpinner.style.zIndex = 0;
            this.routes.push(route);
            if (i == 0)
              this.animate_route(0, direction, resolve);
          },
          error: (error) => {
            console.log(error);
            setTimeout(() => {
              this.animate_routes(direction, starting_index + 1).then(resolve);
            }, 300);
          },
          timeout: 5000
        });
      }
    })
  }

  // animate_route : Index Direction [Promise Resolve] -> _
  // Draws the lines representing one particular route at _index_ (of Points and Cables)
  async animate_route(route_index, direction, resolve) {

    this.update_info_window(direction, route_index);

    if (route_index == this.num_routes)
      resolve();
    
    loadingSpinner.style.zIndex = 0;

    // Wait until the route exists
    while (route_index >= this.routes.length) {
      await timeout(100);
    }
    loadingSpinner.style.zIndex = 0;

    const route = this.routes[route_index];

    let lines = [];
    let blurred_lines = [];
    let color = random_color();

    const animate_connection = async (index) => {
      // cable_path : Cable -> [List-of Coordinate]
      // Creates a path of the coordinates associated with _cable_
      const cable_path = (cable) => {
        // Use the cable nodes
        if (cable.nodes)
          return cable.nodes.map(node => { return { lat: node[1], lng: node[0] }}) 
        // Else skip over the cable entirely
        else {
          return [
            { lat: parseFloat(route[index-1].latitude), lng: parseFloat(route[index-1].longitude) },
            { lat: parseFloat(route[index+1].latitude), lng: parseFloat(route[index+1].longitude) }
          ]
        }
          
      }
  
      // points_path : Point Point -> [List-of Coordinate]
      // Creates path of 2 coordinates between _p1_ and _p2_
      const points_path = (p1, p2) => {
        return [
          { lat: parseFloat(p1.latitude), lng: parseFloat(p1.longitude) },
          { lat: parseFloat(p2.latitude), lng: parseFloat(p2.longitude) }
        ]
      }
  
      const speed = $('input#speed').val();
  
      if (index == route.length - 1) {
        clear_lines(lines);
        draw_lines(blurred_lines);
        return;
      } else {
        let p1 = route[index];
        let p2 = route[index+1];
  
        // Skip to the cable connection
        if (p2.type == "cable")
          await animate_connection(index + 1)
        else {
          let path = [];
          if (p1.type == "cable")
            path = cable_path(p1)
          else
            path = points_path(p1, p2)
  
          lines.push(draw_line(path, color, false, speed));
          blurred_lines.push(draw_line(path, color, true, speed));
  
          if (animation_flag) {
            await timeout(1000/speed);
            return await animate_connection(index + 1);
          } else {
            clear_lines(lines);
            clear_lines(this.blurred_lines);
            clear_lines(blurred_lines);
            return blurred_lines;
          }
        }
      }
    }


    if (animation_flag) {
      await animate_connection(0);
      this.animate_route(route_index + 1, direction, resolve);
      this.blurred_lines = this.blurred_lines.concat(blurred_lines);
    }
    else {
      clear_lines(blurred_lines);
      clear_lines(this.blurred_lines);
    }
  }
}

// ANIMATION-SPECIFIC HELPERS

// draw_line : [List-of Coordinate] Color Boolean Speed -> Line
// Draw a line on _map_ using a given _path_, dependent on if the line is _blurred_
function draw_line(path, color, blurred, speed) {

  const line = new google.maps.Polyline({
    path,
    geodesic: false,
    strokeColor: color,
    strokeOpacity: blurred ? 0.5 : 1.0,
    strokeWeight: blurred ? 2 : 3,
  });

  if (blurred) {
    line.setMap(null);
  } else {
    line.setMap(map);
    animate_packet(line, speed, path);
  }
  return line;
}

// animate_packet : Line Speed [List-of Coordinate] -> _
// Animate a packet icon along _path_ at _speed_ on _line_, such that it mimics the speed at which the route is drawn
function animate_packet(line, speed, path) {
  line.set("icons", [
    {
      icon: packetSymbol,
      offset: "0%"
    }
  ]);

  let total_time = 1000/speed;
  let time_per_interval = 25;
  let num_intervals = total_time/time_per_interval;
  let offset = 0;
  const interval = window.setInterval(() => {
    offset += 100/num_intervals;
    const icons = line.get("icons");

    icons[0].offset = offset + "%";
    line.set("icons", icons);

    if (auto_focus)
      set_center(path, offset);

    if (offset >= 100) {
      window.clearInterval(interval);
      line.set("icons", []);
    }
  }, time_per_interval)
}

function draw_lines(lines) {
  lines.forEach(line => {
    line.setMap(map);
  })
}

function clear_lines(lines) {
  lines.forEach(line => {
    line.setMap(null);
  })
}

// display_server : Dict -> _
// Displays the server marker on the map, using the location specified by _server_data_
function display_server(server_data) {
  let destination = {
    "type": "router",
    "ip": server_data.ip_details.ip,
    "latitude": server_data.ip_details.latitude,
    "longitude": server_data.ip_details.longitude
  }

  destinationPosition.lat = parseFloat(destination.latitude);
  destinationPosition.lng = parseFloat(destination.longitude);

  destinationMarker = new google.maps.Marker({
    position: destinationPosition,
    map,
    icon: icons["server"].icon,
    title: "Destination location",
  });
  // Add the marker to the map
  destinationMarker.setMap(map);
}

